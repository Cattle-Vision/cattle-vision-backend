import type { NextFunction, Request, Response } from "express";

type PrimitiveProp = string | number | boolean | null;

type ServerTrackFn = (
  eventName: string,
  properties?: Record<string, PrimitiveProp>,
  options?: { headers?: Request["headers"] }
) => Promise<void>;

let cachedTrackPromise: Promise<ServerTrackFn | null> | null = null;

/**
 * Carrega `@vercel/analytics/server` via `import()` nativo preservado em CommonJS.
 * Necessário porque a condição `"node"` de `@vercel/analytics/package.json` aponta para `.mjs`,
 * causando `ERR_REQUIRE_ESM` quando `tsc` (module: commonjs) emite `require(...)`.
 */
function getServerTrack(): Promise<ServerTrackFn | null> {
  if (!cachedTrackPromise) {
    cachedTrackPromise = (
      new Function('return import("@vercel/analytics/server")') as () => Promise<{
        track?: ServerTrackFn;
      }>
    )()
      .then((mod) => (typeof mod?.track === "function" ? mod.track : null))
      .catch(() => null);
  }
  return cachedTrackPromise;
}

/**
 * Normaliza caminhos da API removendo IDs numéricos/UUID para evitar alta cardinalidade no Vercel Web Analytics.
 */
function normalizeApiRoute(pathname: string): string {
  return pathname
    .replace(/\/\d+(?=\/|$)/g, "/[id]")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}(?=\/|$)/gi, "/[uuid]")
    .slice(0, 255);
}

/**
 * Converte propriedades arbitrárias para o formato aceito pelo `@vercel/analytics/server` (até 255 chars).
 */
function sanitizeProperties(
  properties?: Record<string, PrimitiveProp | undefined>
): Record<string, PrimitiveProp> | undefined {
  if (!properties) return undefined;
  const clean: Record<string, PrimitiveProp> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    clean[key.slice(0, 255)] =
      typeof value === "string" ? value.slice(0, 255) : value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Dispara evento server-side não-bloqueante para o Vercel Web Analytics.
 * Executa apenas em ambiente Vercel (onde `VERCEL` ou `VERCEL_URL` estão configurados) e nunca propaga erros.
 */
export function trackBackendEvent(
  eventName: string,
  req: Request,
  properties?: Record<string, PrimitiveProp | undefined>
): void {
  if (
    !process.env.VERCEL &&
    !process.env.VERCEL_URL &&
    !process.env.VERCEL_WEB_ANALYTICS_ENDPOINT
  ) {
    return;
  }

  try {
    const safeProps = sanitizeProperties(properties);
    // Usa o requestContext da Vercel (waitUntil) quando disponível, sem atrasar a resposta da API
    void getServerTrack()
      .then((trackFn) =>
        trackFn
          ? trackFn(eventName.slice(0, 255), safeProps, { headers: req.headers })
          : undefined
      )
      .catch(() => {});
  } catch {
    // Telemetria nunca pode impactar o fluxo HTTP principal
  }
}

/**
 * Middleware Express para registrar chamadas relevantes da API REST no Vercel Web Analytics.
 * Ignora preflight OPTIONS, healthchecks e downloads diretos de mídia para evitar ruído e overhead.
 */
export function vercelAnalyticsMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const method = req.method.toUpperCase();
  const rawPath = (req.path || req.url || "/").split("?")[0];

  const shouldSkip =
    method === "OPTIONS" ||
    rawPath === "/" ||
    rawPath === "/api/health" ||
    rawPath === "/health" ||
    rawPath.startsWith("/_vercel/") ||
    (method === "GET" && /^\/api\/photos\/\d+\/?$/.test(rawPath));

  if (!shouldSkip) {
    const route = normalizeApiRoute(rawPath);
    const isMutation = method !== "GET" && method !== "HEAD";
    const isKeyRead =
      route === "/api/animals/rfid-scan" ||
      route === "/api/admin/export" ||
      route === "/api/admin/stats" ||
      route === "/api/ics/queue/status";

    if (isMutation || isKeyRead) {
      trackBackendEvent("api_request", req, { method, route });
    }
  }

  next();
}
