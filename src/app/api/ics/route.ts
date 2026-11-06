/**
 * API de Diagnóstico e Predição de ICS Bovino (`src/app/api/ics/route.ts`).
 *
 * Funcionalidades:
 * - GET /api/ics: status do subsistema de ICS (modo local ou microserviço).
 * - POST /api/ics: inferência de ICS a partir de imagem em multipart/form-data ou octet-stream.
 */
import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";
import { evaluateIcsFromBuffer } from "@/lib/ics";
import { requireAuth } from "@/lib/auth-guard";

export const maxDuration = 45;
export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

export async function GET(request: Request) {
  const externalUrl = process.env.ICS_SERVICE_URL?.trim();
  return corsJsonResponse(
    {
      status: "ready",
      scale: "1.0 - 5.0",
      architecture: {
        mode: externalUrl ? "external_microservice" : "internal_backend",
        externalConfigured: Boolean(externalUrl),
        modelStatus: "IN_DEVELOPMENT",
      },
      description: "Serviço de Diagnóstico Neural de Índice de Condição Corporal (ICS) Bovino",
      version: "1.0.0",
    },
    200,
    request
  );
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;

  try {
    let buffer: Buffer | null = null;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (file && typeof (file as Blob).arrayBuffer === "function") {
        buffer = Buffer.from(await (file as Blob).arrayBuffer());
      }
    } else {
      buffer = Buffer.from(await request.arrayBuffer());
    }

    if (!buffer || buffer.byteLength < 256) {
      return corsJsonResponse({ error: "Frame de imagem inválido ou ausente." }, 400, request);
    }

    const result = await evaluateIcsFromBuffer(buffer);
    return corsJsonResponse(result, 200, request);
  } catch (err) {
    console.error("[/api/ics] Erro ao processar requisição:", err);
    return corsJsonResponse(
      {
        status: "IN_DEVELOPMENT",
        score: null,
        scale: "1.0 - 5.0",
        classification: "Em desenvolvimento",
        message: "Módulo neural em treinamento.",
        source: "development-placeholder",
        estimatedAt: new Date().toISOString(),
      },
      200,
      request
    );
  }
}
