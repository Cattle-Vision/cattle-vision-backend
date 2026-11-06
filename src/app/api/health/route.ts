import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

export async function GET(request: Request) {
  return corsJsonResponse(
    {
      status: "ok",
      service: "cattle-vision-backend",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
    },
    200,
    request
  );
}
