import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CustodyService } from "../animals/custody.service";
import type { TokenPayload } from "../auth/jwt.utils";
import { AiVisionService } from "../vision/ai-vision.service";
import { IcsService } from "../vision/ics.service";
import { PhotoRecalibrationService } from "../vision/photo-recalibration.service";
import { StorageService } from "../vision/storage.service";

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyService: CustodyService,
    private readonly aiVision: AiVisionService,
    private readonly storage: StorageService,
    private readonly icsService: IcsService,
    private readonly photoRecalibration: PhotoRecalibrationService
  ) {}

  async getPhotoBinary(params: {
    photoId: string;
    user?: TokenPayload;
    rawWidth?: string;
    acceptHeader?: string;
    ifNoneMatch?: string;
  }): Promise<
    | { notModified: true; etag: string }
    | { notModified: false; etag: string; buffer: Buffer; contentType: string }
  > {
    const { photoId, user, rawWidth, acceptHeader, ifNoneMatch } = params;
    if (!photoId) {
      throw new BadRequestException("ID da foto não fornecido");
    }

    const photo = await this.prisma.photo
      .findUnique({
        where: { id: photoId },
        include: { animal: { select: { ownerId: true, tag: true } } },
      })
      .catch(() => null);

    if (!photo) {
      throw new NotFoundException("Foto não encontrada");
    }

    if (user) {
      const hasAccess = await this.custodyService.canAccessAnimal(
        photo.animalId,
        photo.animal?.ownerId ?? 0,
        Number(user.id),
        user.role === "ADMIN"
      );
      if (!hasAccess) {
        throw new ForbiddenException("Acesso negado a esta foto");
      }
    }

    const parsedWidth = Number(rawWidth || "0");
    const targetWidth =
      Number.isFinite(parsedWidth) && parsedWidth >= 120 && parsedWidth <= 1600
        ? Math.round(parsedWidth)
        : 0;
    const wantsWebp =
      targetWidth > 0 && (acceptHeader || "").toLowerCase().includes("image/webp");
    const etag = `"${photo.id}-${targetWidth || "full"}-${wantsWebp ? "webp" : "orig"}"`;

    if (ifNoneMatch === etag) {
      return { notModified: true, etag };
    }

    const resolved = await this.storage.readPhotoBuffer(photo.filePath);
    if (!resolved) {
      throw new NotFoundException("Arquivo de imagem indisponível no storage");
    }

    let outputBuffer = resolved.buffer;
    let outputContentType = resolved.contentType;

    if (targetWidth > 0 && targetWidth < 1600) {
      try {
        const { default: sharp } = await import("sharp");
        const pipeline = sharp(resolved.buffer)
          .rotate()
          .resize(targetWidth, null, { withoutEnlargement: true });

        if (wantsWebp) {
          outputBuffer = await pipeline.webp({ quality: 78 }).toBuffer();
          outputContentType = "image/webp";
        } else {
          outputBuffer = await pipeline.jpeg({ quality: 78, mozjpeg: true }).toBuffer();
          outputContentType = "image/jpeg";
        }
      } catch {
        // Fallback silencioso para buffer original em formatos raros
      }
    }

    return {
      notModified: false,
      etag,
      buffer: outputBuffer,
      contentType: outputContentType,
    };
  }

  async scoreBuffer(buffer: Buffer, fastLive = false) {
    if (!buffer || buffer.byteLength < 256) {
      throw new BadRequestException("Frame inválido ou imagem ausente.");
    }

    try {
      const result = await this.aiVision.analyzeRearImage(buffer, { fastLive });
      const ics = fastLive
        ? this.icsService.buildDevelopmentPlaceholder()
        : await this.icsService.evaluateIcsFromBuffer(buffer);
      return { ...result, ics };
    } catch (err) {
      console.error("[/api/photos/score] Erro ao calcular score:", err);
      return {
        score: 0,
        confidence: 0,
        lowQuality: true,
        error: true,
        source: "vision-analysis",
        feedback: "Falha ao processar frame na IA — tente novamente.",
        ics: this.icsService.buildDevelopmentPlaceholder(),
      };
    }
  }

  async uploadPhoto(params: {
    user: TokenPayload;
    file?: Express.Multer.File;
    animalId?: string;
    view?: string;
    preScore?: string;
    aiSource?: string;
  }) {
    const { user, file } = params;
    const animalId = String(params.animalId ?? "").trim();
    const view = String(params.view ?? "REAR").trim().toUpperCase() || "REAR";

    if (!file || !file.buffer || !animalId) {
      throw new BadRequestException("Arquivo de imagem ou identificação do animal ausente.");
    }
    if (file.size < 512) {
      throw new BadRequestException("Arquivo de imagem inválido ou vazio.");
    }
    if (file.size > 15 * 1024 * 1024) {
      throw new BadRequestException("Arquivo maior que 15 MB.");
    }

    const animal = await this.prisma.animal.findUnique({ where: { id: animalId } });
    if (!animal) {
      throw new NotFoundException("Animal não encontrado.");
    }

    const hasAccess = await this.custodyService.canAccessAnimal(
      animal.id,
      animal.ownerId,
      Number(user.id),
      user.role === "ADMIN"
    );
    if (!hasAccess) {
      throw new ForbiddenException("Você não tem permissão para adicionar fotos a este animal.");
    }

    const { filePath, optimizedBuffer, storageType } = await this.storage.storePhotoBuffer(
      animal.tag,
      file.buffer
    );

    // Edge AI: quando o dispositivo do operador ja calculou o enquadramento com
    // os modelos ONNX locais (inclusive offline antes do sync), preservamos o
    // score validado no cliente sem duplicar inferencia de enquadramento no servidor.
    // Apenas a futura analise de ICS permanece exclusivamente no backend.
    const parsedClientScore =
      params.aiSource === "yolo-onnx-client" && params.preScore !== undefined
        ? Number(params.preScore)
        : NaN;
    const hasValidatedClientScore =
      Number.isFinite(parsedClientScore) && parsedClientScore >= 0 && parsedClientScore <= 100;

    const aiScore = hasValidatedClientScore
      ? Math.round(parsedClientScore * 10) / 10
      : (await this.aiVision.analyzeRearImage(optimizedBuffer)).score;
    // O modelo YOLO26m de ICS (~78 MB) roda sob demanda via fila persistente para manter o upload ágil em campo.
    const ics = this.icsService.buildPendingPlaceholder("NOT_REQUESTED");

    const photo = await this.prisma.photo.create({
      data: {
        animalId,
        filePath,
        view,
        score: aiScore,
        icsStatus: ics.status,
        icsScore: ics.score,
        icsClassification: ics.classification,
        slaughterReady: ics.slaughterReady,
        slaughterStatus: ics.slaughterStatus,
        slaughterReason: ics.slaughterReason,
        morphologicalFeatures:
          ics.morphologicalFeatures !== null
            ? (ics.morphologicalFeatures as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        contourPoints:
          ics.contourPoints !== null
            ? (ics.contourPoints as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        aiModelVersion: ics.aiModelVersion,
        evaluatedAt: ics.status === "CALCULATED" ? new Date(ics.estimatedAt) : null,
      },
      select: {
        id: true,
        animalId: true,
        view: true,
        score: true,
        icsStatus: true,
        icsScore: true,
        icsClassification: true,
        slaughterReady: true,
        slaughterStatus: true,
        slaughterReason: true,
        morphologicalFeatures: true,
        contourPoints: true,
        aiModelVersion: true,
        evaluatedAt: true,
        createdAt: true,
      },
    });

    await this.prisma.animal
      .update({
        where: { id: animalId },
        data: { updatedAt: new Date() },
      })
      .catch(() => {});

    const lowQuality = aiScore !== null && aiScore < 40.0;

    return {
      success: true,
      photo: { ...photo, ics },
      score: aiScore,
      confidence: aiScore,
      ics,
      lowQuality,
      storageType,
    };
  }

  async recalibratePhoto(photoId: string, user: TokenPayload) {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      include: {
        animal: {
          select: { id: true, tag: true, ownerId: true },
        },
      },
    });

    if (!photo) {
      throw new NotFoundException("Foto não encontrada");
    }

    const hasAccess = await this.custodyService.canAccessAnimal(
      photo.animal?.id || "",
      photo.animal?.ownerId ?? 0,
      Number(user.id),
      user.role === "ADMIN"
    );
    if (!hasAccess) {
      throw new ForbiddenException("Você não tem permissão para recalcular esta foto");
    }

    const { updated, analysis, ics } = await this.photoRecalibration.recalibratePhotoRecord({
      id: photo.id,
      filePath: photo.filePath,
      score: photo.score,
      animalId: photo.animal?.id || photo.animalId,
    });

    if (photo.animal?.id) {
      await this.prisma.animal
        .update({
          where: { id: photo.animal.id },
          data: { updatedAt: new Date() },
        })
        .catch(() => {});
    }

    return {
      success: true,
      message: `Confiança de enquadramento atualizada: ${Math.round(analysis.score)}%!`,
      newScore: analysis.score,
      score: analysis.score,
      photo: { ...updated, ics },
      analysis,
      ics,
    };
  }

  async deletePhoto(photoId: string, user: TokenPayload) {
    if (!photoId) {
      throw new BadRequestException("ID da foto não fornecido");
    }

    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      include: { animal: { select: { ownerId: true } } },
    });

    const isOwner = photo?.animal?.ownerId === Number(user.id);
    const isAdmin = user.role === "ADMIN";
    if (!photo || (!isOwner && !isAdmin)) {
      throw new NotFoundException("Foto não encontrada");
    }

    await this.storage.deleteStoredFile(photo.filePath);
    await this.prisma.photo.delete({ where: { id: photoId } });

    return { ok: true, message: "Foto excluída com sucesso." };
  }
}
