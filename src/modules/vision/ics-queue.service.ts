import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { TokenPayload } from "../auth/jwt.utils";
import { IcsService } from "./ics.service";
import { StorageService } from "./storage.service";

interface ClaimedIcsJobRow {
  id: string;
  photoId: string;
  animalId: string;
  requestedById: number | null;
  status: string;
  priority: number;
  attempts: number;
  createdAt: Date;
}

/**
 * Serviço de Fila Persistente de Inferência ICS (`src/modules/vision/ics-queue.service.ts`).
 *
 * Motivação arquitetural:
 * - O modelo `YOLO26m` FP32 (~78 MB) é significativamente mais pesado que os validadores rápidos.
 * - Armazena os pedidos em tabela PostgreSQL (`IcsJob`) para suportar filas compartilhadas entre
 *   múltiplos operadores no Vercel Serverless (onde filas puramente em memória seriam encerradas
 *   entre invocações).
 * - Usa `FOR UPDATE SKIP LOCKED` para garantir processamento atômico 1-a-1 sem corrida.
 */
@Injectable()
export class IcsQueueService {
  private tableEnsured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly icsService: IcsService
  ) {}

  async ensureQueueTable(): Promise<void> {
    if (this.tableEnsured) return;
    try {
      const existing = await this.prisma.$queryRaw<Array<{ reg: string | null }>>`
        SELECT to_regclass('"IcsJob"')::text AS reg
      `;
      if (existing?.[0]?.reg) {
        this.tableEnsured = true;
        return;
      }

      await this.prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "IcsJob" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "photoId" TEXT NOT NULL,
          "animalId" TEXT NOT NULL,
          "requestedById" INTEGER,
          "status" TEXT NOT NULL DEFAULT 'QUEUED',
          "priority" INTEGER NOT NULL DEFAULT 0,
          "attempts" INTEGER NOT NULL DEFAULT 0,
          "error" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "startedAt" TIMESTAMP(3),
          "completedAt" TIMESTAMP(3),
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "IcsJob_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT "IcsJob_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "IcsJob_status_priority_createdAt_idx" ON "IcsJob"("status", "priority", "createdAt")`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "IcsJob_photoId_status_idx" ON "IcsJob"("photoId", "status")`
      );
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "IcsJob_animalId_status_idx" ON "IcsJob"("animalId", "status")`
      );
      this.tableEnsured = true;
    } catch (err) {
      console.warn("[ICS-Queue] ensureQueueTable warning:", (err as Error).message);
    }
  }

  private async assertAnimalAccess(animalId: string, user: TokenPayload): Promise<void> {
    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      select: { id: true, ownerId: true },
    });
    if (!animal) {
      throw new NotFoundException("Animal não encontrado.");
    }

    const userId = Number(user.id);
    if (user.role === "ADMIN" || animal.ownerId === userId) return;

    const collab = await this.prisma.animalCollaborator
      .findUnique({
        where: { animalId_userId: { animalId, userId } },
        select: { id: true },
      })
      .catch(() => null);

    if (!collab) {
      throw new ForbiddenException("Você não tem permissão para solicitar ICS deste animal.");
    }
  }

  /**
   * Recupera jobs presos em `PROCESSING` por mais de 90s (caso uma função serverless tenha expirado).
   */
  private async recoverStaleJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - 90_000);
    await this.prisma.icsJob
      .updateMany({
        where: {
          status: "PROCESSING",
          startedAt: { lt: staleBefore },
          attempts: { lt: 3 },
        },
        data: { status: "QUEUED", startedAt: null },
      })
      .catch(() => {});

    await this.prisma.icsJob
      .updateMany({
        where: {
          status: "PROCESSING",
          startedAt: { lt: staleBefore },
          attempts: { gte: 3 },
        },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: "Tempo limite excedido após 3 tentativas na fila.",
        },
      })
      .catch(() => {});
  }

  async enqueuePhoto(
    photoId: string,
    user: TokenPayload,
    options?: { force?: boolean; priority?: number }
  ) {
    await this.ensureQueueTable();
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      select: { id: true, animalId: true, icsStatus: true },
    });
    if (!photo) {
      throw new NotFoundException("Foto não encontrada.");
    }

    await this.assertAnimalAccess(photo.animalId, user);

    if (!options?.force && photo.icsStatus === "CALCULATED") {
      return {
        queued: false,
        alreadyCalculated: true,
        message: "Esta foto já possui ICS calculado. Use 'Regerar ICS' se desejar reprocessar.",
      };
    }

    const existingActive = await this.prisma.icsJob.findFirst({
      where: {
        photoId: photo.id,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      orderBy: { createdAt: "asc" },
    });

    if (existingActive) {
      const statusSummary = await this.getQueueStatus(photo.animalId);
      const pos =
        statusSummary.jobs.find((j) => j.id === existingActive.id)?.position ?? 1;
      return {
        queued: true,
        alreadyQueued: true,
        job: existingActive,
        position: pos,
        totalQueued: statusSummary.queuedCount,
        message: `Foto já está na fila de processamento (posição #${pos}).`,
      };
    }

    const priority = options?.priority ?? (user.role === "ADMIN" ? 5 : 0);
    const [job] = await this.prisma.$transaction([
      this.prisma.icsJob.create({
        data: {
          photoId: photo.id,
          animalId: photo.animalId,
          requestedById: Number(user.id) || null,
          status: "QUEUED",
          priority,
        },
      }),
      this.prisma.photo.update({
        where: { id: photo.id },
        data: { icsStatus: "QUEUED" },
      }),
    ]);

    const statusSummary = await this.getQueueStatus(photo.animalId);
    const pos = statusSummary.jobs.find((j) => j.id === job.id)?.position ?? 1;

    return {
      queued: true,
      job,
      position: pos,
      totalQueued: statusSummary.queuedCount,
      message: `Solicitação enviada para a fila de ICS (posição #${pos}).`,
    };
  }

  async enqueueAnimal(
    animalId: string,
    user: TokenPayload,
    options?: { force?: boolean }
  ) {
    await this.ensureQueueTable();
    await this.assertAnimalAccess(animalId, user);

    const photos = await this.prisma.photo.findMany({
      where: { animalId },
      select: { id: true, icsStatus: true },
      orderBy: { createdAt: "desc" },
    });

    if (photos.length === 0) {
      return {
        queuedCount: 0,
        totalPhotos: 0,
        queuedTotal: 0,
        message: "Este animal ainda não possui fotos para calcular ICS.",
      };
    }

    const targets = options?.force
      ? photos
      : photos.filter((p) => p.icsStatus !== "CALCULATED");

    if (targets.length === 0) {
      return {
        queuedCount: 0,
        totalPhotos: photos.length,
        queuedTotal: 0,
        message: "Todas as fotos deste animal já possuem ICS calculado.",
      };
    }

    const activeJobs = await this.prisma.icsJob.findMany({
      where: {
        animalId,
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      select: { photoId: true },
    });
    const activePhotoIds = new Set(activeJobs.map((j) => j.photoId));

    const toCreate = targets.filter((p) => !activePhotoIds.has(p.id));
    const priority = user.role === "ADMIN" ? 5 : 0;
    const requestedById = Number(user.id) || null;

    if (toCreate.length > 0) {
      await this.prisma.$transaction([
        this.prisma.icsJob.createMany({
          data: toCreate.map((p) => ({
            photoId: p.id,
            animalId,
            requestedById,
            status: "QUEUED",
            priority,
          })),
        }),
        this.prisma.photo.updateMany({
          where: { id: { in: toCreate.map((p) => p.id) } },
          data: { icsStatus: "QUEUED" },
        }),
      ]);
    }

    const statusSummary = await this.getQueueStatus(animalId);
    return {
      queuedCount: toCreate.length,
      alreadyInQueue: targets.length - toCreate.length,
      totalPhotos: photos.length,
      queuedTotal: statusSummary.queuedCount,
      animalQueuedCount: statusSummary.animalQueuedCount,
      message:
        toCreate.length > 0
          ? `${toCreate.length} foto(s) adicionada(s) à fila de ICS.`
          : "As fotos selecionadas já estão na fila de processamento.",
    };
  }

  async enqueueAdminRegenerate(
    caller: TokenPayload,
    options?: { animalId?: string; onlyMissing?: boolean }
  ) {
    await this.ensureQueueTable();
    const animalId = options?.animalId?.trim();
    const onlyMissing = Boolean(options?.onlyMissing);

    const photos = await this.prisma.photo.findMany({
      where: {
        ...(animalId ? { animalId } : {}),
        ...(onlyMissing ? { icsStatus: { not: "CALCULATED" } } : {}),
      },
      select: { id: true, animalId: true },
      orderBy: { createdAt: "desc" },
    });

    if (photos.length === 0) {
      return {
        queuedCount: 0,
        totalCount: 0,
        message: "Nenhuma foto elegível encontrada para regeneração de ICS.",
      };
    }

    const activeJobs = await this.prisma.icsJob.findMany({
      where: {
        photoId: { in: photos.map((p) => p.id) },
        status: { in: ["QUEUED", "PROCESSING"] },
      },
      select: { photoId: true },
    });
    const activePhotoIds = new Set(activeJobs.map((j) => j.photoId));

    const toCreate = photos.filter((p) => !activePhotoIds.has(p.id));
    const requestedById = Number(caller.id) || null;

    if (toCreate.length > 0) {
      await this.prisma.$transaction([
        this.prisma.icsJob.createMany({
          data: toCreate.map((p) => ({
            photoId: p.id,
            animalId: p.animalId,
            requestedById,
            status: "QUEUED",
            priority: 10,
          })),
        }),
        this.prisma.photo.updateMany({
          where: { id: { in: toCreate.map((p) => p.id) } },
          data: { icsStatus: "QUEUED" },
        }),
      ]);
    }

    const statusSummary = await this.getQueueStatus(animalId);
    return {
      queuedCount: toCreate.length,
      alreadyInQueue: photos.length - toCreate.length,
      totalCount: photos.length,
      queuedTotal: statusSummary.queuedCount,
      message: `${toCreate.length} foto(s) colocada(s) na fila para regeneração de ICS.`,
    };
  }

  async getQueueStatus(animalId?: string) {
    await this.ensureQueueTable();
    await this.recoverStaleJobs();

    const orderedQueued = await this.prisma.icsJob.findMany({
      where: { status: { in: ["QUEUED", "PROCESSING"] } },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        photoId: true,
        animalId: true,
        status: true,
        priority: true,
        attempts: true,
        createdAt: true,
        startedAt: true,
      },
    });

    let queueCursor = 0;
    const withPosition = orderedQueued.map((job) => {
      const position = job.status === "PROCESSING" ? 0 : ++queueCursor;
      return { ...job, position };
    });

    const processingCount = withPosition.filter((j) => j.status === "PROCESSING").length;
    const queuedCount = withPosition.filter((j) => j.status === "QUEUED").length;

    const scopedJobs = animalId
      ? withPosition.filter((j) => j.animalId === animalId)
      : withPosition.slice(0, 50);

    return {
      queuedCount,
      processingCount,
      totalPending: queuedCount + processingCount,
      animalQueuedCount: animalId
        ? scopedJobs.filter((j) => j.status === "QUEUED").length
        : queuedCount,
      animalProcessingCount: animalId
        ? scopedJobs.filter((j) => j.status === "PROCESSING").length
        : processingCount,
      jobs: scopedJobs,
    };
  }

  /**
   * Reivindica atomicamente o próximo job `QUEUED` (via `FOR UPDATE SKIP LOCKED`),
   * executa `YOLO26m` ONNX sobre a imagem original armazenada e atualiza o registro da foto.
   */
  async processNextJob(targetAnimalId?: string) {
    await this.ensureQueueTable();
    await this.recoverStaleJobs();

    const cleanAnimalId = targetAnimalId?.trim() || null;
    const claimed = cleanAnimalId
      ? await this.prisma.$queryRaw<ClaimedIcsJobRow[]>`
          UPDATE "IcsJob"
          SET "status" = 'PROCESSING',
              "startedAt" = NOW(),
              "attempts" = "attempts" + 1,
              "updatedAt" = NOW()
          WHERE "id" = (
            SELECT "id"
            FROM "IcsJob"
            WHERE "status" = 'QUEUED' AND "animalId" = ${cleanAnimalId}
            ORDER BY "priority" DESC, "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING "id", "photoId", "animalId", "requestedById", "status", "priority", "attempts", "createdAt"
        `
      : await this.prisma.$queryRaw<ClaimedIcsJobRow[]>`
          UPDATE "IcsJob"
          SET "status" = 'PROCESSING',
              "startedAt" = NOW(),
              "attempts" = "attempts" + 1,
              "updatedAt" = NOW()
          WHERE "id" = (
            SELECT "id"
            FROM "IcsJob"
            WHERE "status" = 'QUEUED'
            ORDER BY "priority" DESC, "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING "id", "photoId", "animalId", "requestedById", "status", "priority", "attempts", "createdAt"
        `;

    const remainingWhere = cleanAnimalId
      ? { animalId: cleanAnimalId, status: { in: ["QUEUED", "PROCESSING"] } }
      : { status: { in: ["QUEUED", "PROCESSING"] } };

    const job = claimed?.[0];
    if (!job) {
      const remaining = await this.prisma.icsJob.count({
        where: remainingWhere,
      });
      return {
        processed: false,
        remainingQueued: remaining,
        message: "Nenhum job pendente na fila de ICS.",
      };
    }

    await this.prisma.photo
      .update({
        where: { id: job.photoId },
        data: { icsStatus: "PROCESSING" },
      })
      .catch(() => {});

    try {
      const photo = await this.prisma.photo.findUnique({
        where: { id: job.photoId },
        select: { id: true, animalId: true, filePath: true },
      });

      if (!photo) {
        await this.prisma.icsJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: "Foto não existe mais no banco.",
          },
        });
        const remaining = await this.prisma.icsJob.count({
          where: { status: { in: ["QUEUED", "PROCESSING"] } },
        });
        return { processed: false, jobId: job.id, remainingQueued: remaining };
      }

      const photoData = await this.storage.readPhotoBuffer(photo.filePath);
      if (!photoData?.buffer) {
        await this.prisma.$transaction([
          this.prisma.photo.update({
            where: { id: photo.id },
            data: {
              icsStatus: "FAILED",
              slaughterReason: "Arquivo de imagem indisponível no storage.",
            },
          }),
          this.prisma.icsJob.update({
            where: { id: job.id },
            data: {
              status: "FAILED",
              completedAt: new Date(),
              error: "Arquivo de imagem indisponível no storage.",
            },
          }),
        ]);
        const remaining = await this.prisma.icsJob.count({
          where: { status: { in: ["QUEUED", "PROCESSING"] } },
        });
        return { processed: false, jobId: job.id, photoId: photo.id, remainingQueued: remaining };
      }

      const ics = await this.icsService.evaluateIcsFromBuffer(photoData.buffer);
      const nextPhotoStatus = ics.status === "CALCULATED" ? "CALCULATED" : "FAILED";

      const [updatedPhoto, completedJob] = await this.prisma.$transaction([
        this.prisma.photo.update({
          where: { id: photo.id },
          data: {
            icsStatus: nextPhotoStatus,
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
            evaluatedAt: nextPhotoStatus === "CALCULATED" ? new Date(ics.estimatedAt) : null,
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
        }),
        this.prisma.icsJob.update({
          where: { id: job.id },
          data: {
            status: nextPhotoStatus === "CALCULATED" ? "COMPLETED" : "FAILED",
            completedAt: new Date(),
            error: nextPhotoStatus === "CALCULATED" ? null : ics.message,
          },
        }),
      ]);

      await this.prisma.animal
        .update({
          where: { id: photo.animalId },
          data: { updatedAt: new Date() },
        })
        .catch(() => {});

      const remaining = await this.prisma.icsJob.count({
        where: remainingWhere,
      });

      return {
        processed: true,
        job: completedJob,
        photo: { ...updatedPhoto, ics },
        ics,
        remainingQueued: remaining,
      };
    } catch (err) {
      const msg = (err as Error)?.message || "Erro inesperado ao processar job ICS.";
      await this.prisma.$transaction([
        this.prisma.photo.update({
          where: { id: job.photoId },
          data: { icsStatus: "FAILED", slaughterReason: msg },
        }),
        this.prisma.icsJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            error: msg,
          },
        }),
      ]).catch(() => {});

      const remaining = await this.prisma.icsJob.count({
        where: remainingWhere,
      });
      return {
        processed: false,
        jobId: job.id,
        photoId: job.photoId,
        error: msg,
        remainingQueued: remaining,
      };
    }
  }
}
