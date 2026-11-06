import { NextResponse } from "next/server";

/**
 * Utilitário Centralizado de CORS (`src/lib/cors.ts`).
 *
 * Responsabilidade:
 * - Habilitar chamadas Cross-Origin seguras entre o Frontend (em outros computadores,
 *   portas, domínios ou projetos Vercel) e o Backend.
 * - Ler a variável `CORS_ORIGIN` do ambiente:
 *   - Se vazia ou "*", reflete a origem requisitante ou "*".
 *   - Se contiver origens separadas por vírgula (ex: "http://localhost:3000,https://meu-app.vercel.app"),
 *     valida se a requisição veio de uma origem permitida.
 * - Fornecer headers preflight para requisições HTTP `OPTIONS` com status 204.
 */

export function getCorsHeaders(request?: Request): HeadersInit {
  const originHeader = request?.headers.get("origin") || "";
  const allowedConfig = (process.env.CORS_ORIGIN || "*").trim();

  let resolvedOrigin = "*";

  if (allowedConfig === "*") {
    // Quando configurado para "*", se a requisição trouxer Origin, refletimos para suportar credentials
    resolvedOrigin = originHeader || "*";
  } else {
    const originsList = allowedConfig.split(",").map((o) => o.trim().toLowerCase());
    if (originHeader && originsList.includes(originHeader.toLowerCase())) {
      resolvedOrigin = originHeader;
    } else {
      resolvedOrigin = originsList[0] || "*";
    }
  }

  return {
    "Access-Control-Allow-Origin": resolvedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With, Accept, Accept-Version, X-Api-Version",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * Responde imediatamente a requisições de preflight HTTP OPTIONS.
 */
export function handleCorsPreflight(request: Request): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}

/**
 * Anexa headers CORS a uma resposta NextResponse já existente.
 */
export function withCors(response: NextResponse, request?: Request): NextResponse {
  const headers = getCorsHeaders(request);
  Object.entries(headers).forEach(([key, val]) => {
    response.headers.set(key, String(val));
  });
  return response;
}

/**
 * Cria uma resposta JSON com os headers de CORS automaticamente aplicados.
 */
export function corsJsonResponse(
  data: unknown,
  init?: number | { status?: number; headers?: HeadersInit },
  request?: Request
): NextResponse {
  const status = typeof init === "number" ? init : init?.status ?? 200;
  const extraHeaders = typeof init === "object" ? init?.headers : undefined;

  const corsHeaders = getCorsHeaders(request);
  const response = NextResponse.json(data, {
    status,
    headers: {
      ...corsHeaders,
      ...extraHeaders,
    },
  });

  return response;
}
