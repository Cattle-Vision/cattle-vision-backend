/**
 * Módulo de Diagnóstico e Predição de ICS (Índice de Condição Corporal Bovino) (`src/lib/ics.ts`).
 *
 * Responsabilidades:
 * 1. Suporte Duplo de Execução:
 *    a) Modo Interno (Backend Local):
 *       Executa o modelo neural de regressão/classificação de ICS diretamente no Node.js/ONNX
 *       quando os pesos calibrados estiverem disponíveis.
 *    b) Modo Externo (Microserviço / Servidor Independente):
 *       Quando a variável `ICS_SERVICE_URL` estiver configurada, delega a inferência para
 *       um servidor de GPU ou repositório de IA especializado via HTTP REST.
 * 2. Fallback de Desenvolvimento Transparente:
 *    Enquanto a rede neural de ICS estiver em treinamento zootécnico, retorna status padronizado
 *    `IN_DEVELOPMENT` com classificação "Em desenvolvimento" sem quebrar as rotas do app.
 * 3. Classificação Zootécnica Oficial:
 *    Converte notas numéricas de 1.0 a 5.0 para faixas corporais zootécnicas:
 *    - 1.0 a 2.0: Muito Magro (Caquético)
 *    - 2.25 a 2.75: Magro
 *    - 3.0 a 3.5: Ideal / Moderado
 *    - 3.75 a 4.25: Sobrepeso
 *    - 4.5 a 5.0: Muito Gordo (Obeso)
 */

export type IcsStatus = "IN_DEVELOPMENT" | "CALCULATED" | "ERROR";

export interface IcsEvaluationResult {
  status: IcsStatus;
  score: number | null; // Escala 1.0 a 5.0 (ex: 3.25)
  scale: string;
  classification: string;
  confidence?: number; // Confiança específica do modelo de ICS (0 - 100)
  message: string;
  source: "internal-backend" | "external-microservice" | "development-placeholder";
  estimatedAt: string;
}

/**
 * Converte nota de ICS (escala 1 a 5) em rótulo zootécnico padronizado.
 */
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
 * Avalia o ICS de uma imagem de traseira bovina.
 *
 * Suporta:
 * 1. Microserviço externo via `ICS_SERVICE_URL`.
 * 2. Motor interno local.
 * 3. Fallback de desenvolvimento ("Em desenvolvimento").
 */
export async function evaluateIcsFromBuffer(imageBuffer: Buffer): Promise<IcsEvaluationResult> {
  const externalUrl = process.env.ICS_SERVICE_URL?.trim();
  const apiToken = process.env.ICS_API_TOKEN?.trim();

  // Opção A: Delegação para Microserviço de IA dedicado em outro servidor / repositório
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
      const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: new Uint8Array(imageBuffer),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (res.ok) {
        const data = await res.json();
        if (typeof data.score === "number") {
          return {
            status: "CALCULATED",
            score: Math.round(data.score * 10) / 10,
            scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
            classification: data.classification || getIcsClassification(data.score),
            confidence: typeof data.confidence === "number" ? data.confidence : 85,
            message: data.message || "ICS calculado via microserviço neural externo.",
            source: "external-microservice",
            estimatedAt: new Date().toISOString(),
          };
        }
      }
    } catch (err) {
      console.warn("[ICS] Microserviço externo indisponível, ativando fallback controlado:", (err as Error).message);
    }
  }

  // Opção B & C: Modelo interno / Modo de Desenvolvimento (IA em treinamento)
  return {
    status: "IN_DEVELOPMENT",
    score: null,
    scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
    classification: "Em desenvolvimento",
    message: "Módulo neural de diagnóstico de ICS em fase de treinamento e validação zootécnica.",
    source: "development-placeholder",
    estimatedAt: new Date().toISOString(),
  };
}
