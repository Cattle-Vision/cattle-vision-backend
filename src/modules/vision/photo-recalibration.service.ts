import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AiVisionService, RearDetectionResult } from "./ai-vision.service";
import { IcsEvaluationResult, IcsService } from "./ics.service";
import { StorageService } from "./storage.service";

export interface RecalibratedPhotoOutput {
  id: string;
  animalId: string;
  score: number;
  view: string;
  icsStatus: string;
  icsScore: number | null;
  icsClassification: string | null;
  slaughterReady: boolean | null;
  slaughterStatus: string | null;
  slaughterReason: string | null;
  createdAt: Date;
}

export interface RecalibratedBatchItem {
  id: string;
  tag?: string;
  oldScore: number | null;
  newScore: number;
}

/**
 * Serviço Canônico de Recalibragem IA (`src/modules/vision/photo-recalibration.service.ts`).
 *
 * Por que existe como serviço único em `VisionModule`:
 * Os quatro pontos de recalibragem (foto individual, lote do animal, rebanho do usuário e
 * dataset global do administrador) antes executavam fluxos separados e atualizavam conjuntos
 * distintos de colunas/concorrências. Centralizar todos em um único método garante 100% de
 * paridade determinística entre todos os botões e dispositivos, sempre lendo o arquivo
 * original em alta resolução armazenado.
 */
@Injectable()
export class PhotoRecalibrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly aiVision: AiVisionService,
    private readonly icsService: IcsService
  ) {}

  async recalibratePhotoRecord(photo: {
    id: string;
    filePath: string;
    score: number | null;
    animalId: string;
  }): Promise<{
    updated: RecalibratedPhotoOutput;
    analysis: RearDetectionResult;
    ics: IcsEvaluationResult;
  }> {
    const photoData = await this.storage.readPhotoBuffer(photo.filePath);
    if (!photoData?.buffer) {
      throw new NotFoundException("Arquivo de imagem original indisponível para reprocessamento");
    }

    const analysis = await this.aiVision.analyzeRearImage(photoData.buffer);
    const ics = await this.icsService.evaluateIcsFromBuffer(photoData.buffer);

    const updated = await this.prisma.photo.update({
      where: { id: photo.id },
      data: {
        score: analysis.score,
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
        score: true,
        view: true,
        icsStatus: true,
        icsScore: true,
        icsClassification: true,
        slaughterReady: true,
        slaughterStatus: true,
        slaughterReason: true,
        createdAt: true,
      },
    });

    return {
      updated: {
        ...updated,
        score: updated.score ?? analysis.score,
      },
      analysis,
      ics,
    };
  }

  async recalibrateBatch(
    photos: Array<{
      id: string;
      filePath: string;
      score: number | null;
      animalId: string;
      tag?: string;
    }>
  ): Promise<{
    updatedCount: number;
    totalCount: number;
    results: RecalibratedBatchItem[];
  }> {
    let updatedCount = 0;
    const affectedAnimalIds = new Set<string>();
    const results: RecalibratedBatchItem[] = [];

    // Processamento estritamente sequencial (1 foto por vez) para evitar travamentos ONNX/CPU e garantir paridade absoluta
    for (const photo of photos) {
      try {
        const { analysis } = await this.recalibratePhotoRecord(photo);
        affectedAnimalIds.add(photo.animalId);
        updatedCount++;
        results.push({
          id: photo.id,
          tag: photo.tag,
          oldScore: photo.score,
          newScore: analysis.score,
        });
      } catch (err) {
        console.warn(`[recalibrate] Erro ao recalcular foto ${photo.id}:`, err);
      }
    }

    if (affectedAnimalIds.size > 0) {
      await this.prisma.animal
        .updateMany({
          where: { id: { in: Array.from(affectedAnimalIds) } },
          data: { updatedAt: new Date() },
        })
        .catch(() => {});
    }

    return {
      updatedCount,
      totalCount: photos.length,
      results,
    };
  }
}
