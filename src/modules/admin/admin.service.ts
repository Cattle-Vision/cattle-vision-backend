import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import bcrypt from "bcryptjs";
import { runWithConcurrency } from "../../common/utils/async.utils";
import { PrismaService } from "../../prisma/prisma.service";
import type { TokenPayload } from "../auth/jwt.utils";
import { AiVisionService } from "../vision/ai-vision.service";
import { IcsService } from "../vision/ics.service";
import { PhotoRecalibrationService } from "../vision/photo-recalibration.service";
import { StorageService } from "../vision/storage.service";

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly aiVision: AiVisionService,
    private readonly photoRecalibration: PhotoRecalibrationService,
    private readonly icsService: IcsService
  ) {}

  async listAnimals() {
    const animals = await this.prisma.animal.findMany({
      include: {
        photos: {
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
          orderBy: { createdAt: "desc" },
        },
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return animals.map((animal) => {
      const photos = (animal.photos || []).map((p) => ({
        ...p,
        ics: this.icsService.formatPhotoRecordIcs(p),
      }));
      return {
        ...animal,
        ics: this.icsService.summarizeAnimalIcs(photos),
        photos,
      };
    });
  }

  async listUsers(caller: TokenPayload) {
    const callerId = Number(caller.id);
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        animals: {
          select: {
            id: true,
            _count: { select: { photos: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      animalsCount: u.animals.length,
      photosCount: u.animals.reduce((acc, a) => acc + a._count.photos, 0),
      isSelf: u.id === callerId,
    }));
  }

  async buildExportZip(): Promise<{ buffer: Buffer; filename: string }> {
    const animals = await this.prisma.animal.findMany({
      include: {
        photos: { orderBy: { createdAt: "desc" } },
        observationRecords: { orderBy: { observedAt: "desc" } },
        _count: {
          select: {
            vaccines: true,
            diseases: true,
            observationRecords: true,
          },
        },
        owner: { select: { name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const escapeCsv = (val: unknown) => {
      const str = String(val ?? "");
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
    };

    const { default: AdmZip } = await import("adm-zip");
    const zip = new AdmZip();
    const manifest: Array<Record<string, unknown>> = [];
    const csvRows: string[] = [
      [
        "file",
        "photo_id",
        "animal_id",
        "tag",
        "name",
        "breed",
        "sex",
        "weight_kg",
        "age_months",
        "length_cm",
        "location",
        "location_address",
        "latitude",
        "longitude",
        "observations",
        "observations_count",
        "vaccines_count",
        "diseases_count",
        "view",
        "ai_score",
        "ics_status",
        "ics_score",
        "slaughter_status",
        "created_at",
        "owner_name",
        "owner_email",
      ].join(","),
    ];

    const exportItems = animals.flatMap((animal) =>
      animal.photos.map((photo) => ({ animal, photo }))
    );

    const fetchedBuffers = await runWithConcurrency(exportItems, 6, async ({ photo }) => {
      try {
        const photoData = await this.storage.readPhotoBuffer(photo.filePath);
        return photoData?.buffer ?? null;
      } catch (err) {
        console.error("[/api/admin/export] Erro ao ler foto:", photo.id, err);
        return null;
      }
    });

    exportItems.forEach(({ animal, photo }, idx) => {
      const fileName = `${animal.tag}_${photo.id}.jpg`;
      const filePath = `images/${fileName}`;
      const buf = fetchedBuffers[idx];
      if (buf) {
        zip.addFile(filePath, buf);
      }

      manifest.push({
        file: filePath,
        photoId: photo.id,
        animalId: animal.id,
        tag: animal.tag,
        name: animal.name,
        breed: animal.breed,
        sex: animal.sex,
        weight: animal.weight,
        age: animal.age,
        length: animal.length,
        location: animal.location,
        locationAddress: animal.locationAddress,
        latitude: animal.latitude,
        longitude: animal.longitude,
        observations: animal.observations,
        observationsCount: animal._count.observationRecords,
        vaccinesCount: animal._count.vaccines,
        diseasesCount: animal._count.diseases,
        view: photo.view,
        aiScore: photo.score,
        icsStatus: photo.icsStatus,
        icsScore: photo.icsScore,
        slaughterStatus: photo.slaughterStatus,
        createdAt: photo.createdAt.toISOString(),
        owner: {
          name: animal.owner.name,
          email: animal.owner.email,
        },
      });

      csvRows.push(
        [
          escapeCsv(filePath),
          escapeCsv(photo.id),
          escapeCsv(animal.id),
          escapeCsv(animal.tag),
          escapeCsv(animal.name),
          escapeCsv(animal.breed),
          escapeCsv(animal.sex),
          escapeCsv(animal.weight),
          escapeCsv(animal.age),
          escapeCsv(animal.length ?? ""),
          escapeCsv(animal.location),
          escapeCsv(animal.locationAddress ?? ""),
          escapeCsv(animal.latitude ?? ""),
          escapeCsv(animal.longitude ?? ""),
          escapeCsv(animal.observations),
          escapeCsv(animal._count.observationRecords),
          escapeCsv(animal._count.vaccines),
          escapeCsv(animal._count.diseases),
          escapeCsv(photo.view),
          escapeCsv(photo.score ?? ""),
          escapeCsv(photo.icsStatus),
          escapeCsv(photo.icsScore ?? ""),
          escapeCsv(photo.slaughterStatus),
          escapeCsv(photo.createdAt.toISOString()),
          escapeCsv(animal.owner.name),
          escapeCsv(animal.owner.email),
        ].join(",")
      );
    });

    // CSV dedicado à tabela AnimalObservation ("Outras Observações")
    const obsRows: string[] = [
      [
        "observation_id",
        "animal_id",
        "tag",
        "animal_name",
        "category",
        "title",
        "content",
        "observed_at",
        "created_by_name",
      ].join(","),
    ];
    for (const animal of animals) {
      for (const obs of animal.observationRecords) {
        obsRows.push(
          [
            escapeCsv(obs.id),
            escapeCsv(animal.id),
            escapeCsv(animal.tag),
            escapeCsv(animal.name),
            escapeCsv(obs.category),
            escapeCsv(obs.title),
            escapeCsv(obs.content),
            escapeCsv(obs.observedAt.toISOString()),
            escapeCsv(obs.createdByName),
          ].join(",")
        );
      }
    }

    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));
    zip.addFile("dataset.csv", Buffer.from(csvRows.join("\n"), "utf-8"));
    zip.addFile("observations.csv", Buffer.from(obsRows.join("\n"), "utf-8"));

    const buffer = zip.toBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return {
      buffer,
      filename: `cattle-ics-dataset-${timestamp}.zip`,
    };
  }

  async recalibrateAll() {
    const photos = await this.prisma.photo.findMany({
      select: {
        id: true,
        filePath: true,
        score: true,
        animalId: true,
        animal: { select: { tag: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const batch = await this.photoRecalibration.recalibrateBatch(
      photos.map((photo) => ({
        id: photo.id,
        filePath: photo.filePath,
        score: photo.score,
        animalId: photo.animalId,
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

  async createOrPromoteUser(
    caller: TokenPayload,
    body: { name?: unknown; email?: unknown; password?: unknown; role?: unknown }
  ) {
    const callerId = Number(caller.id);
    const name = String(body.name || "").trim();
    const email = String(body.email || "")
      .toLowerCase()
      .trim();
    const password = String(body.password || "");
    const targetRole = body.role === "ADMIN" ? "ADMIN" : "USER";

    if (!name || !email) {
      throw new BadRequestException("Nome e e-mail são obrigatórios");
    }

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      const updateData: { name: string; role: string; password?: string } = {
        name: name || existing.name,
        role: targetRole,
      };
      if (password && password.length >= 6) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: updateData,
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });

      return {
        ...updated,
        animalsCount: 0,
        photosCount: 0,
        isSelf: updated.id === callerId,
        updatedExisting: true,
      };
    }

    if (!password || password.length < 6) {
      throw new BadRequestException("Para novos usuários, a senha deve ter pelo menos 6 caracteres");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const created = await this.prisma.user.create({
      data: { name, email, password: hashedPassword, role: targetRole },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });

    return {
      ...created,
      animalsCount: 0,
      photosCount: 0,
      isSelf: created.id === callerId,
    };
  }

  async updateUser(
    targetUserIdRaw: string,
    caller: TokenPayload,
    body: { role?: unknown; name?: unknown; password?: unknown }
  ) {
    const userId = Number(targetUserIdRaw);
    const callerId = Number(caller.id);
    if (!Number.isFinite(userId)) {
      throw new BadRequestException("ID de usuário inválido");
    }

    const targetUser = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      throw new NotFoundException("Usuário não encontrado");
    }

    if (userId === callerId && body.role && body.role !== "ADMIN") {
      throw new BadRequestException(
        "Você não pode remover seu próprio privilégio de administrador."
      );
    }

    const updateData: { role?: string; name?: string; password?: string } = {};
    if (body.role === "ADMIN" || body.role === "USER") updateData.role = body.role;
    if (typeof body.name === "string" && body.name.trim()) updateData.name = body.name.trim();
    if (typeof body.password === "string" && body.password.length >= 6) {
      updateData.password = await bcrypt.hash(body.password, 10);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
  }

  async deleteUser(targetUserIdRaw: string, caller: TokenPayload) {
    const userId = Number(targetUserIdRaw);
    const callerId = Number(caller.id);
    if (!Number.isFinite(userId)) {
      throw new BadRequestException("ID de usuário inválido");
    }
    if (userId === callerId) {
      throw new BadRequestException("Você não pode excluir sua própria conta de administrador.");
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { message: "Usuário removido com sucesso" };
  }
}
