import { Injectable } from "@nestjs/common";

export type IcsStatus = "IN_DEVELOPMENT" | "CALCULATED" | "ERROR";
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
    return "Em desenvolvimento";
  }

  if (score < 2.0) return "Muito Magro (Caquético)";
  if (score <= 2.5) return "Magro";
  if (score <= 3.5) return "Ideal / Moderado";
  if (score <= 4.25) return "Sobrepeso";
  return "Muito Gordo (Obeso)";
}

/**
 * Serviço de Avaliação de ICS, Contorno Corporal e Aptidão para Abate (`src/modules/vision/ics.service.ts`).
 *
 * Diretriz crítica:
 * - O modelo neural de ICS, contorno e aptidão para abate ainda não existe e NÃO deve simular notas.
 * - Enquanto `ICS_SERVICE_URL` não estiver configurado/disponível, retorna contrato estruturado
 *   explícito com `aiAvailable: false` e `status: "IN_DEVELOPMENT"` para aviso transparente ao usuário.
 */
@Injectable()
export class IcsService {
  buildDevelopmentPlaceholder(): IcsEvaluationResult {
    return {
      aiAvailable: false,
      status: "IN_DEVELOPMENT",
      score: null,
      scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
      classification: "Em desenvolvimento",
      slaughterReady: null,
      slaughterStatus: "IN_DEVELOPMENT",
      slaughterLabel: "Em desenvolvimento",
      slaughterReason:
        "Modelo neural de avaliação corporal e aptidão para abate ainda não implementado.",
      morphologicalFeatures: null,
      contourPoints: null,
      aiModelVersion: null,
      message:
        "IA de avaliação de ICS ainda em desenvolvimento (modelo neural não disponível para execução).",
      source: "development-placeholder",
      estimatedAt: new Date().toISOString(),
    };
  }

  getServiceInfo() {
    const externalUrl = process.env.ICS_SERVICE_URL?.trim();
    return {
      status: "in_development",
      aiAvailable: Boolean(externalUrl),
      modelStatus: externalUrl ? "EXTERNAL_CONFIGURED" : "IN_DEVELOPMENT",
      scale: "1.0 - 5.0",
      notice:
        "A IA de avaliação de ICS, contorno corporal e aptidão para abate ainda está em desenvolvimento e não está em execução.",
      architecture: {
        mode: externalUrl ? "external_microservice" : "development_placeholder",
        externalConfigured: Boolean(externalUrl),
        modelStatus: "IN_DEVELOPMENT",
      },
      description: "Serviço de Diagnóstico de Índice de Condição Corporal (ICS) e Abate Bovino",
      version: "1.1.0",
    };
  }

  async evaluateIcsFromBuffer(imageBuffer?: Buffer): Promise<IcsEvaluationResult> {
    const externalUrl = process.env.ICS_SERVICE_URL?.trim();
    const apiToken = process.env.ICS_API_TOKEN?.trim();

    if (externalUrl && imageBuffer && imageBuffer.byteLength > 0) {
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
            const score = Math.round(data.score * 10) / 10;
            const slaughterReady =
              typeof data.slaughterReady === "boolean" ? data.slaughterReady : null;
            const slaughterStatus: SlaughterStatus =
              slaughterReady === true
                ? "READY"
                : slaughterReady === false
                ? "NOT_READY"
                : "IN_DEVELOPMENT";

            return {
              aiAvailable: true,
              status: "CALCULATED",
              score,
              scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
              classification: data.classification || getIcsClassification(score),
              slaughterReady,
              slaughterStatus,
              slaughterLabel:
                slaughterReady === true
                  ? "Apto para abate"
                  : slaughterReady === false
                  ? "Ainda não apto"
                  : "Em desenvolvimento",
              slaughterReason:
                typeof data.slaughterReason === "string"
                  ? data.slaughterReason
                  : "Avaliação realizada via microserviço neural externo.",
              morphologicalFeatures:
                data.morphologicalFeatures && typeof data.morphologicalFeatures === "object"
                  ? data.morphologicalFeatures
                  : null,
              contourPoints: Array.isArray(data.contourPoints) ? data.contourPoints : null,
              aiModelVersion:
                typeof data.aiModelVersion === "string" ? data.aiModelVersion : "external-v1",
              confidence: typeof data.confidence === "number" ? data.confidence : 85,
              message: data.message || "ICS calculado via microserviço neural externo.",
              source: "external-microservice",
              estimatedAt: new Date().toISOString(),
            };
          }
        }
      } catch (err) {
        console.warn(
          "[ICS] Microserviço externo indisponível, mantendo aviso de desenvolvimento:",
          (err as Error).message
        );
      }
    }

    return this.buildDevelopmentPlaceholder();
  }
}
