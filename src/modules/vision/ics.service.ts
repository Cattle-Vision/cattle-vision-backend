import { Injectable } from "@nestjs/common";
import { AiVisionService } from "./ai-vision.service";

export type IcsStatus =
  | "IN_DEVELOPMENT"
  | "NOT_REQUESTED"
  | "QUEUED"
  | "PROCESSING"
  | "CALCULATED"
  | "FAILED"
  | "ERROR";
export type SlaughterStatus = "IN_DEVELOPMENT" | "READY" | "NOT_READY";

export interface IcsEvaluationResult {
  aiAvailable: boolean;
  status: IcsStatus;
  score: number | null;
  scale: string;
  classification: string;
  slaughterReady: boolean | null;
  slaughterStatus: SlaughterStatus;
  slaughterLabel: string;
  slaughterReason: string;
  morphologicalFeatures: Record<string, number> | null;
  contourPoints: Array<{ x: number; y: number }> | null;
  aiModelVersion: string | null;
  confidence?: number;
  message: string;
  source: "internal-backend" | "external-microservice" | "development-placeholder";
  estimatedAt: string;
}

export function getIcsClassification(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) {
    return "Não calculado";
  }

  if (score < 2.0) return "Muito Magro (Caquético)";
  if (score <= 2.5) return "Magro";
  if (score <= 3.5) return "Ideal / Moderado";
  if (score <= 4.25) return "Sobrepeso";
  return "Muito Gordo (Obeso)";
}

/**
 * Serviço de Avaliação de ICS Corporal via YOLO26m ONNX (`src/modules/vision/ics.service.ts`).
 *
 * Executa exclusivamente no backend (Vercel Serverless / Node):
 * - Suporta microserviço externo opcional via `ICS_SERVICE_URL`.
 * - Caso não definido, executa `ics_yolo26m.onnx` (convertido de `YOLO26_VACAS_MEDIO.pt`)
 *   via `AiVisionService.analyzeIcsImage`.
 */
@Injectable()
export class IcsService {
  constructor(private readonly aiVision: AiVisionService) {}

  buildPendingPlaceholder(status: IcsStatus = "NOT_REQUESTED", customMessage?: string): IcsEvaluationResult {
    const labelByStatus: Record<string, string> = {
      QUEUED: "Na fila de processamento",
      PROCESSING: "Processando IA de ICS...",
      FAILED: "Falha / Não identificado",
      ERROR: "Falha / Não identificado",
      NOT_REQUESTED: "Aguardando solicitação",
      IN_DEVELOPMENT: "Aguardando solicitação",
    };

    const msgByStatus: Record<string, string> = {
      QUEUED: "Captura na fila aguardando análise de condição corporal.",
      PROCESSING: "Analisando a condição corporal desta captura.",
      FAILED: customMessage || "Não foi possível avaliar o ICS desta captura.",
      ERROR: customMessage || "Não foi possível avaliar o ICS desta captura.",
      NOT_REQUESTED: "Solicite a avaliação para calcular o ICS desta captura.",
      IN_DEVELOPMENT: "Solicite a avaliação para calcular o ICS desta captura.",
    };

    return {
      aiAvailable: true,
      status,
      score: null,
      scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
      classification: labelByStatus[status] || "Aguardando solicitação",
      slaughterReady: null,
      slaughterStatus: "IN_DEVELOPMENT",
      slaughterLabel: labelByStatus[status] || "Aguardando cálculo",
      slaughterReason: msgByStatus[status] || "Solicite a avaliação de ICS.",
      morphologicalFeatures: null,
      contourPoints: null,
      aiModelVersion: null,
      message: msgByStatus[status] || "Solicite a avaliação de ICS.",
      source: "internal-backend",
      estimatedAt: new Date().toISOString(),
    };
  }

  /** Mantido por compatibilidade com chamadas legadas que esperam um slot pendente. */
  buildDevelopmentPlaceholder(): IcsEvaluationResult {
    return this.buildPendingPlaceholder("NOT_REQUESTED");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatPhotoRecordIcs(p: any): IcsEvaluationResult {
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
            : "Aguardando definição",
        slaughterReason: p.slaughterReason || "Avaliação de condição corporal concluída.",
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

    if (p?.icsStatus === "QUEUED") {
      return this.buildPendingPlaceholder("QUEUED");
    }
    if (p?.icsStatus === "PROCESSING") {
      return this.buildPendingPlaceholder("PROCESSING");
    }
    if (p?.icsStatus === "FAILED" || p?.icsStatus === "ERROR") {
      return this.buildPendingPlaceholder(p.icsStatus, p?.slaughterReason || undefined);
    }

    return this.buildPendingPlaceholder("NOT_REQUESTED");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  summarizeAnimalIcs(formattedPhotos: Array<{ ics?: IcsEvaluationResult }>): IcsEvaluationResult {
    const latestCalculated = formattedPhotos.find((p) => p.ics?.status === "CALCULATED")?.ics;
    if (latestCalculated) return latestCalculated;

    const processing = formattedPhotos.find((p) => p.ics?.status === "PROCESSING")?.ics;
    if (processing) return processing;

    const queued = formattedPhotos.find((p) => p.ics?.status === "QUEUED")?.ics;
    if (queued) return queued;

    const failed = formattedPhotos.find(
      (p) => p.ics?.status === "FAILED" || p.ics?.status === "ERROR"
    )?.ics;
    if (failed) return failed;

    return this.buildPendingPlaceholder("NOT_REQUESTED");
  }

  getServiceInfo() {
    const externalUrl = process.env.ICS_SERVICE_URL?.trim();
    return {
      status: "active",
      aiAvailable: true,
      modelStatus: externalUrl ? "EXTERNAL_CONFIGURED" : "ACTIVE",
      queueEnabled: true,
      modelVersion: "yolo26m-ics-v1",
      classes: ["3.25", "3.5", "3.75", "4.0", "4.25"],
      scale: "1.0 - 5.0",
      notice:
        "IA de avaliação de ICS (YOLO26m ONNX) ativa exclusivamente no backend, operando com fila persistente.",
      architecture: {
        mode: externalUrl ? "external_microservice" : "internal_backend_onnx",
        externalConfigured: Boolean(externalUrl),
        modelStatus: "ACTIVE",
      },
      description: "Serviço de Diagnóstico de Índice de Condição Corporal (ICS) Bovino (YOLO26m)",
      version: "2.0.0",
    };
  }

  async evaluateIcsFromBuffer(imageBuffer?: Buffer): Promise<IcsEvaluationResult> {
    if (!imageBuffer || imageBuffer.byteLength === 0) {
      return this.buildPendingPlaceholder("ERROR", "Buffer de imagem ausente para análise de ICS.");
    }

    const externalUrl = process.env.ICS_SERVICE_URL?.trim();
    const apiToken = process.env.ICS_API_TOKEN?.trim();

    if (externalUrl) {
      try {
        const endpoint = `${externalUrl.replace(/\/$/, "")}/evaluate`;
        const headers: Record<string, string> = {
          "Content-Type": "application/octet-stream",
        };
        if (apiToken) {
          headers["Authorization"] = `Bearer ${apiToken}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: new Uint8Array(imageBuffer),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (res.ok) {
          const data = await res.json();
          if (typeof data.score === "number") {
            const score = Math.round(data.score * 100) / 100;
            const slaughterReady =
              typeof data.slaughterReady === "boolean" ? data.slaughterReady : score >= 3.25;
            const slaughterStatus: SlaughterStatus = slaughterReady ? "READY" : "NOT_READY";

            return {
              aiAvailable: true,
              status: "CALCULATED",
              score,
              scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
              classification: data.classification || getIcsClassification(score),
              slaughterReady,
              slaughterStatus,
              slaughterLabel: slaughterReady ? "Apto (cobertura ≥ 3,25)" : "Ainda não apto",
              slaughterReason:
                typeof data.slaughterReason === "string"
                  ? data.slaughterReason
                  : "Avaliação automática concluída.",
              morphologicalFeatures:
                data.morphologicalFeatures && typeof data.morphologicalFeatures === "object"
                  ? data.morphologicalFeatures
                  : null,
              contourPoints: Array.isArray(data.contourPoints) ? data.contourPoints : null,
              aiModelVersion:
                typeof data.aiModelVersion === "string" ? data.aiModelVersion : "external-v1",
              confidence: typeof data.confidence === "number" ? data.confidence : 85,
              message: data.message || "ICS calculado com sucesso.",
              source: "external-microservice",
              estimatedAt: new Date().toISOString(),
            };
          }
        }
      } catch (err) {
        console.warn(
          "[ICS] Microserviço externo indisponível, seguindo para YOLO26m ONNX interno:",
          (err as Error).message
        );
      }
    }

    try {
      const det = await this.aiVision.analyzeIcsImage(imageBuffer);
      if (!det.detected || det.score === null) {
        return {
          aiAvailable: true,
          status: "FAILED",
          score: null,
          scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
          classification: "Não identificado",
          slaughterReady: null,
          slaughterStatus: "IN_DEVELOPMENT",
          slaughterLabel: "Não identificado",
          slaughterReason:
            "O animal não pôde ser identificado com clareza suficiente nesta imagem.",
          morphologicalFeatures: null,
          contourPoints: null,
          aiModelVersion: det.modelVersion,
          confidence: 0,
          message: "Não foi possível identificar o animal para calcular o ICS.",
          source: "internal-backend",
          estimatedAt: new Date().toISOString(),
        };
      }

      const score = det.score;
      const confPct = Math.round(det.confidence * 1000) / 10;
      const slaughterReady = score >= 3.25;

      const features: Record<string, number> = {
        confidence: confPct,
        classIndex: det.classIndex ?? -1,
      };
      if (det.box) {
        features.boxCx = Math.round(det.box.cx * 1000) / 1000;
        features.boxCy = Math.round(det.box.cy * 1000) / 1000;
        features.boxW = Math.round(det.box.w * 1000) / 1000;
        features.boxH = Math.round(det.box.h * 1000) / 1000;
      }
      if (det.classProbabilities) {
        for (const [k, v] of Object.entries(det.classProbabilities)) {
          features[`prob_${k.replace(".", "_")}`] = Math.round(v * 1000) / 10;
        }
      }

      return {
        aiAvailable: true,
        status: "CALCULATED",
        score,
        scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
        classification: getIcsClassification(score),
        slaughterReady,
        slaughterStatus: slaughterReady ? "READY" : "NOT_READY",
        slaughterLabel: slaughterReady ? "Boa cobertura (ICS ≥ 3,25)" : "Ainda não apto",
        slaughterReason: `Nota ${score.toFixed(2).replace(".", ",")} · ${getIcsClassification(score)} (${confPct}% de confiança).`,
        morphologicalFeatures: features,
        contourPoints: det.contourPoints,
        aiModelVersion: det.modelVersion,
        confidence: confPct,
        message: `ICS ${score.toFixed(2).replace(".", ",")} (${getIcsClassification(score)}) calculado.`,
        source: "internal-backend",
        estimatedAt: new Date().toISOString(),
      };
    } catch (err) {
      return this.buildPendingPlaceholder(
        "FAILED",
        `Erro ao executar modelo ICS no servidor: ${(err as Error).message}`
      );
    }
  }
}
