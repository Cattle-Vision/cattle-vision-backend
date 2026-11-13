import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { isValidTag, normalizeTag } from "../../common/utils/animal.utils";
import type { TokenPayload } from "../auth/jwt.utils";
import { AiVisionService } from "../vision/ai-vision.service";
import { IcsEvaluationResult, IcsService, getIcsClassification } from "../vision/ics.service";
import { PhotoRecalibrationService } from "../vision/photo-recalibration.service";
import { StorageService } from "../vision/storage.service";
import { CustodyService } from "./custody.service";

export const photoMetadataSelect = {
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
} as const;

/**
 * Serviço Principal de Rebanho (`src/modules/animals/animals.service.ts`).
 */
@Injectable()
export class AnimalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyService: CustodyService,
    private readonly aiVision: AiVisionService,
    private readonly storage: StorageService,
    private readonly icsService: IcsService,
    private readonly photoRecalibration: PhotoRecalibrationService
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatPhotoIcs(p: any): IcsEvaluationResult {
    if (p?.icsStatus === "CALCULATED" && typeof p.icsScore === "number") {
      const slaughterReady =
        typeof p.slaughterReady === "boolean" ? p.slaughterReady : null;
      return {
        aiAvailable: true,
        status: "CALCULATED",
        score: p.icsScore,
        scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
        classification: p.icsClassification || getIcsClassification(p.icsScore),
        slaughterReady,
        slaughterStatus: p.slaughterStatus || "IN_DEVELOPMENT",
        slaughterLabel:
          slaughterReady === true
            ? "Apto para abate"
            : slaughterReady === false
            ? "Ainda não apto"
            : "Em desenvolvimento",
        slaughterReason: p.slaughterReason || "Avaliado pelo modelo neural.",
        morphologicalFeatures: p.morphologicalFeatures ?? null,
        contourPoints: Array.isArray(p.contourPoints) ? p.contourPoints : null,
        aiModelVersion: p.aiModelVersion ?? null,
        message: "Avaliação de ICS calculada.",
        source: "internal-backend",
        estimatedAt: p.evaluatedAt
          ? new Date(p.evaluatedAt).toISOString()
          : new Date(p.createdAt || Date.now()).toISOString(),
      };
    }

    return this.icsService.buildDevelopmentPlaceholder();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatAnimalWithIcs(animal: any) {
    if (!animal) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const photos = (animal.photos || []).map((p: any) => ({
      ...p,
      ics: this.formatPhotoIcs(p),
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestCalculated = photos.find((p: any) => p.ics?.status === "CALCULATED");
    const animalIcs = latestCalculated
      ? latestCalculated.ics
      : this.icsService.buildDevelopmentPlaceholder();

    return {
      ...animal,
      ics: animalIcs,
      photos,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async formatAnimalWithIcsAndCustody(animal: any, userId: number, isAdmin: boolean) {
    if (!animal) return null;
    const base = this.formatAnimalWithIcs(animal);
    const custody = await this.custodyService.getCustodyDetails(
      animal.id,
      animal.ownerId,
      userId,
      isAdmin
    );
    return {
      ...base,
      isOwner: animal.ownerId === userId,
      isShared: animal.ownerId !== userId,
      custody,
    };
  }

  async listAnimals(
    user: TokenPayload,
    query: { tag?: string; summary?: string; limit?: string }
  ) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";

    if (query.tag) {
      const normalized = normalizeTag(query.tag);
      const animal = await this.prisma.animal.findFirst({
        where: { tag: normalized },
        include: {
          photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
        },
      });

      if (!animal) {
        throw new NotFoundException("Animal não encontrado");
      }

      const hasAccess = await this.custodyService.canAccessAnimal(
        animal.id,
        animal.ownerId,
        userId,
        isAdmin
      );
      if (!hasAccess) {
        throw new ForbiddenException({
          error:
            "Animal já cadastrado no sistema por outro produtor. Conecte o leitor RFID para ingressar na guarda compartilhada.",
          requiresScan: true,
          tag: normalized,
        });
      }

      return this.formatAnimalWithIcsAndCustody(animal, userId, isAdmin);
    }

    const summaryOnly = query.summary === "1";
    const rawLimit = Number(query.limit || "0");
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(200, Math.round(rawLimit))
        : undefined;

    const { ownedIds, sharedIds } = await this.custodyService.getAccessibleAnimalIds(
      userId,
      isAdmin
    );
    const allIds = Array.from(new Set([...ownedIds, ...sharedIds]));

    if (!isAdmin && allIds.length === 0) {
      return [];
    }

    const animals = await this.prisma.animal.findMany({
      where: isAdmin ? {} : { id: { in: allIds } },
      include: {
        photos: {
          select: photoMetadataSelect,
          orderBy: { createdAt: "desc" },
          ...(summaryOnly ? { take: 1 } : {}),
        },
        ...(summaryOnly ? { _count: { select: { photos: true } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });

    return animals.map((a) => {
      const base = this.formatAnimalWithIcs(a);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const photoCount = (a as any)._count?.photos ?? base.photos?.length ?? 0;
      const { _count, ...rest } = base;
      return {
        ...rest,
        photoCount,
        isOwner: a.ownerId === userId,
        isShared: a.ownerId !== userId,
      };
    });
  }

  async getAnimalById(animalId: string, user: TokenPayload) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";

    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      include: {
        photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
        vaccines: { orderBy: { appliedAt: "desc" } },
        diseases: { orderBy: { diagnosedAt: "desc" } },
        locationLogs: { orderBy: { movedAt: "desc" } },
        observationRecords: { orderBy: { observedAt: "desc" } },
      },
    });

    if (!animal) {
      throw new NotFoundException("Animal não encontrado");
    }

    const hasAccess = await this.custodyService.canAccessAnimal(
      animal.id,
      animal.ownerId,
      userId,
      isAdmin
    );
    if (!hasAccess) {
      throw new ForbiddenException("Você não possui permissão para visualizar este animal.");
    }

    return this.formatAnimalWithIcsAndCustody(animal, userId, isAdmin);
  }

  async createAnimal(
    user: TokenPayload,
    body: {
      tag?: unknown;
      name?: unknown;
      breed?: unknown;
      sex?: unknown;
      weight?: unknown;
      age?: unknown;
      length?: unknown;
      location?: unknown;
      observations?: unknown;
      observationCategory?: unknown;
      observationTitle?: unknown;
    }
  ) {
    const userId = Number(user.id);
    const rawTag = normalizeTag(String(body.tag ?? ""));
    const name = body.name ? String(body.name).trim() : "";
    const breed = String(body.breed ?? "Nelore").trim();
    const sex = String(body.sex ?? "Fêmea").trim();
    const weight = Number(body.weight);
    const age = Number(body.age);
    const location = body.location ? String(body.location).trim() : "";
    const observations = body.observations ? String(body.observations).trim() : "";

    let length: number | null = null;
    if (body.length !== undefined && body.length !== null && String(body.length).trim() !== "") {
      length = Number(body.length);
      if (Number.isNaN(length) || length <= 0) {
        throw new BadRequestException("Tamanho / comprimento deve ser um número positivo (em cm).");
      }
    }

    if (!isValidTag(rawTag)) {
      throw new BadRequestException("Identificador/Brinco/RFID inválido. Mínimo 2 caracteres.");
    }
    if (Number.isNaN(weight) || weight <= 0) {
      throw new BadRequestException("Peso deve ser um número positivo.");
    }
    if (Number.isNaN(age) || age < 0) {
      throw new BadRequestException("Idade deve ser zero ou positiva.");
    }

    const existing = await this.prisma.animal.findFirst({ where: { tag: rawTag } });
    if (existing) {
      if (existing.ownerId === userId) {
        throw new ConflictException({
          error: "Você já possui um animal cadastrado com este brinco/RFID.",
          id: existing.id,
        });
      }
      await this.custodyService.addCollaborator(existing.id, userId);
      throw new ConflictException({
        error:
          "Este animal já está cadastrado por outro produtor. Você foi adicionado à Guarda Compartilhada deste animal!",
        id: existing.id,
        sharedGranted: true,
      });
    }

    const animal = await this.prisma.animal.create({
      data: {
        tag: rawTag,
        name,
        breed,
        sex,
        weight,
        age,
        length,
        location,
        observations,
        ownerId: userId,
      },
    });

    if (location) {
      await this.prisma.animalLocationLog
        .create({
          data: {
            animalId: animal.id,
            location,
            reason: "Localização inicial no cadastro",
            movedById: userId,
          },
        })
        .catch(() => {});
    }

    if (observations) {
      const cat = String(body.observationCategory ?? "GERAL")
        .trim()
        .toUpperCase();
      await this.prisma.animalObservation
        .create({
          data: {
            animalId: animal.id,
            category: ["GERAL", "MANEJO", "NUTRICAO", "COMPORTAMENTO", "OUTRA"].includes(cat)
              ? cat
              : "GERAL",
            title: body.observationTitle ? String(body.observationTitle).trim() : "Nota inicial",
            content: observations,
            createdById: userId,
            createdByName: user.name || user.email || "Operador",
          },
        })
        .catch(() => {});
    }

    return animal;
  }

  async updateAnimal(
    animalId: string,
    user: TokenPayload,
    body: {
      tag?: unknown;
      name?: unknown;
      breed?: unknown;
      sex?: unknown;
      weight?: unknown;
      age?: unknown;
      length?: unknown;
      location?: unknown;
      locationReason?: unknown;
      observations?: unknown;
    }
  ) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";

    const animal = await this.prisma.animal.findUnique({ where: { id: animalId } });
    if (!animal) {
      throw new NotFoundException("Animal não encontrado");
    }

    const hasAccess = await this.custodyService.canAccessAnimal(
      animal.id,
      animal.ownerId,
      userId,
      isAdmin
    );
    if (!hasAccess) {
      throw new ForbiddenException("Você não possui permissão para editar este animal.");
    }

    const updateData: {
      tag?: string;
      name?: string;
      breed?: string;
      sex?: string;
      weight?: number;
      age?: number;
      length?: number | null;
      location?: string;
      observations?: string;
    } = {};

    if (body.tag !== undefined) {
      if (animal.ownerId !== userId && !isAdmin) {
        throw new ForbiddenException(
          "Apenas o proprietário principal pode alterar o brinco/RFID do animal."
        );
      }
      const rawTag = normalizeTag(String(body.tag));
      if (!isValidTag(rawTag)) {
        throw new BadRequestException("Brinco/RFID inválido.");
      }
      if (rawTag !== animal.tag) {
        const conflict = await this.prisma.animal.findFirst({
          where: { tag: rawTag, NOT: { id: animalId } },
        });
        if (conflict) {
          throw new ConflictException("Já existe outro animal cadastrado com este identificador.");
        }
      }
      updateData.tag = rawTag;
    }

    if (body.name !== undefined) {
      updateData.name = body.name ? String(body.name).trim() : "";
    }
    if (body.breed !== undefined) {
      updateData.breed = String(body.breed).trim();
    }
    if (body.sex !== undefined) {
      updateData.sex = String(body.sex).trim();
    }
    if (body.weight !== undefined) {
      const w = Number(body.weight);
      if (Number.isNaN(w) || w <= 0) throw new BadRequestException("Peso inválido.");
      updateData.weight = w;
    }
    if (body.age !== undefined) {
      const a = Number(body.age);
      if (Number.isNaN(a) || a < 0) throw new BadRequestException("Idade inválida.");
      updateData.age = a;
    }
    if (body.length !== undefined) {
      if (body.length === null || String(body.length).trim() === "") {
        updateData.length = null;
      } else {
        const l = Number(body.length);
        if (Number.isNaN(l) || l <= 0) {
          throw new BadRequestException("Tamanho / comprimento inválido.");
        }
        updateData.length = l;
      }
    }
    if (body.location !== undefined) {
      updateData.location = String(body.location ?? "").trim();
    }
    if (body.observations !== undefined) {
      updateData.observations = String(body.observations ?? "").trim();
    }

    const updated = await this.prisma.animal.update({
      where: { id: animalId },
      data: updateData,
      include: {
        photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
        vaccines: { orderBy: { appliedAt: "desc" } },
        diseases: { orderBy: { diagnosedAt: "desc" } },
        locationLogs: { orderBy: { movedAt: "desc" } },
        observationRecords: { orderBy: { observedAt: "desc" } },
      },
    });

    if (
      updateData.location !== undefined &&
      updateData.location !== "" &&
      updateData.location !== animal.location
    ) {
      const log = await this.prisma.animalLocationLog
        .create({
          data: {
            animalId,
            location: updateData.location,
            reason: body.locationReason
              ? String(body.locationReason).trim()
              : "Atualização de localização",
            movedById: userId,
          },
        })
        .catch(() => null);
      if (log) {
        updated.locationLogs = [log, ...updated.locationLogs];
      }
    }

    return this.formatAnimalWithIcsAndCustody(updated, userId, isAdmin);
  }

  async deleteAnimal(animalId: string, user: TokenPayload) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";

    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      include: { photos: { select: { id: true, filePath: true } } },
    });

    if (!animal) {
      throw new NotFoundException("Animal não encontrado");
    }
    if (animal.ownerId !== userId && !isAdmin) {
      throw new ForbiddenException(
        "Apenas o proprietário principal pode excluir este animal do sistema."
      );
    }

    await Promise.allSettled(
      animal.photos.map((photo) => this.storage.deleteStoredFile(photo.filePath))
    );
    await this.prisma.photo.deleteMany({ where: { animalId } });
    await this.prisma.animal.delete({ where: { id: animalId } });

    return { ok: true, message: "Animal excluído com sucesso." };
  }

  async rfidScan(user: TokenPayload, body: { rfid?: unknown; tag?: unknown }) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";
    const rawRfid = normalizeTag(String(body.rfid ?? body.tag ?? ""));

    if (!isValidTag(rawRfid)) {
      throw new BadRequestException("Código RFID inválido ou vazio.");
    }

    const animal = await this.prisma.animal.findFirst({
      where: { tag: rawRfid },
      include: {
        photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
      },
    });

    if (!animal) {
      return {
        registered: false,
        rfid: rawRfid,
        message: "Tag RFID não registrada. Prossiga com o cadastro do novo animal.",
      };
    }

    let sharedGranted = false;
    if (animal.ownerId !== userId) {
      const collabResult = await this.custodyService.addCollaborator(animal.id, userId);
      sharedGranted = collabResult.added;
    }

    const formatted = await this.formatAnimalWithIcsAndCustody(animal, userId, isAdmin);
    return {
      registered: true,
      animal: formatted,
      sharedGranted,
      isOwner: animal.ownerId === userId,
      message:
        animal.ownerId === userId
          ? "Animal identificado com sucesso (Proprietário Principal)."
          : "Animal identificado! Guarda compartilhada ativada com sucesso.",
    };
  }

  async addCollaborator(
    animalId: string,
    user: TokenPayload,
    body: { userId?: unknown; email?: unknown }
  ) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";

    const animal = await this.prisma.animal.findUnique({ where: { id: animalId } });
    if (!animal) {
      throw new NotFoundException("Animal não encontrado");
    }
    if (animal.ownerId !== userId && !isAdmin) {
      throw new ForbiddenException("Apenas o proprietário principal pode convidar colaboradores.");
    }

    let targetUserId = body.userId ? Number(body.userId) : null;
    if (!targetUserId && body.email) {
      const targetUser = await this.prisma.user.findUnique({
        where: { email: String(body.email).toLowerCase().trim() },
        select: { id: true },
      });
      if (!targetUser) {
        throw new NotFoundException("Nenhum usuário com este e-mail foi encontrado.");
      }
      targetUserId = targetUser.id;
    }

    if (!targetUserId) {
      throw new BadRequestException("Informe o e-mail ou o ID do usuário colaborador.");
    }

    const result = await this.custodyService.addCollaborator(animal.id, targetUserId);
    const custody = await this.custodyService.getCustodyDetails(
      animal.id,
      animal.ownerId,
      userId,
      isAdmin
    );
    return { ...result, custody };
  }

  async removeCollaborator(animalId: string, targetUserIdRaw: string, user: TokenPayload) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";
    const targetUserId = Number(targetUserIdRaw);

    if (!targetUserId || Number.isNaN(targetUserId)) {
      throw new BadRequestException("ID do colaborador inválido.");
    }

    const result = await this.custodyService.removeCollaborator(
      animalId,
      targetUserId,
      userId,
      isAdmin
    );
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    const updatedAnimal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      select: { ownerId: true },
    });
    const custody = await this.custodyService.getCustodyDetails(
      animalId,
      updatedAnimal?.ownerId ?? userId,
      userId,
      isAdmin
    );
    return { ...result, custody };
  }

  async transferOwnership(animalId: string, user: TokenPayload, body: { newOwnerId?: unknown }) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";
    const newOwnerId = Number(body.newOwnerId);

    if (!newOwnerId || Number.isNaN(newOwnerId)) {
      throw new BadRequestException("ID do novo proprietário inválido.");
    }

    const targetUser = await this.prisma.user.findUnique({ where: { id: newOwnerId } });
    if (!targetUser) {
      throw new NotFoundException("Novo proprietário não encontrado.");
    }

    const result = await this.custodyService.transferOwnership(
      animalId,
      newOwnerId,
      userId,
      isAdmin
    );
    if (!result.success) {
      throw new BadRequestException(result.message);
    }

    const custody = await this.custodyService.getCustodyDetails(
      animalId,
      newOwnerId,
      userId,
      isAdmin
    );
    return { ...result, custody };
  }

  async recalibrateHerd(user: TokenPayload) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";
    const { ownedIds, sharedIds } = await this.custodyService.getAccessibleAnimalIds(
      userId,
      isAdmin
    );
    const accessibleIds = Array.from(new Set([...ownedIds, ...sharedIds]));
    const whereClause = isAdmin ? {} : { animalId: { in: accessibleIds } };

    const photos = await this.prisma.photo.findMany({
      where: whereClause,
      include: { animal: { select: { id: true, tag: true } } },
      orderBy: { createdAt: "desc" },
    });

    if (photos.length === 0) {
      return {
        success: true,
        message: "Nenhuma foto encontrada para recalibração.",
        updatedCount: 0,
        totalCount: 0,
      };
    }

    const batch = await this.photoRecalibration.recalibrateBatch(
      photos.map((photo) => ({
        id: photo.id,
        filePath: photo.filePath,
        score: photo.score,
        animalId: photo.animal?.id || photo.animalId,
        tag: photo.animal?.tag,
      }))
    );

    return {
      success: true,
      updatedCount: batch.updatedCount,
      totalCount: batch.totalCount,
      message: `${batch.updatedCount} de ${batch.totalCount} fotos foram recalculadas com sucesso!`,
      results: batch.results,
    };
  }

  async recalibrateAnimal(animalId: string, user: TokenPayload) {
    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";

    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      include: {
        photos: {
          select: { id: true, filePath: true, score: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!animal) {
      throw new NotFoundException("Animal não encontrado");
    }

    const hasAccess = await this.custodyService.canAccessAnimal(
      animal.id,
      animal.ownerId,
      userId,
      isAdmin
    );
    if (!hasAccess) {
      throw new ForbiddenException("Você não tem permissão para recalcular as fotos deste animal");
    }

    if (animal.photos.length === 0) {
      return {
        success: true,
        message: "O animal não possui fotos para recalibrar.",
        updatedCount: 0,
        results: [],
      };
    }

    const batch = await this.photoRecalibration.recalibrateBatch(
      animal.photos.map((photo) => ({
        id: photo.id,
        filePath: photo.filePath,
        score: photo.score,
        animalId: animal.id,
        tag: animal.tag,
      }))
    );

    return {
      success: true,
      updatedCount: batch.updatedCount,
      totalCount: batch.totalCount,
      message: `${batch.updatedCount} foto(s) do animal foram recalculadas com sucesso!`,
      results: batch.results,
    };
  }
}
