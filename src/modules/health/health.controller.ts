import { Controller, Get, Header } from "@nestjs/common";

/**
 * Controller de Status e Healthcheck (`src/modules/health/health.controller.ts`).
 */
@Controller()
export class HealthController {
  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  getRootStatus(): string {
    return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <title>CattleVision API Service (NestJS)</title>
    <script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};</script>
    <script defer src="/_vercel/insights/script.js" data-sdkn="@vercel/analytics" data-sdkv="2.0.1"></script>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 24px; line-height: 1.5;">
    <h1 style="color: #10B981;">CattleVision API Service (NestJS)</h1>
    <p>Servidor RESTful NestJS + Prisma + YOLOv8 ONNX ativo.</p>
    <ul>
      <li><code>/api/health</code> - Healthcheck</li>
      <li><code>/api/auth/*</code> - Autenticação JWT</li>
      <li><code>/api/animals/*</code> - Gestão do Rebanho, Custódia, Manejo, Saúde e Observações Gerais</li>
      <li><code>/api/photos/*</code> - Armazenamento e Score IA de Enquadramento</li>
      <li><code>/api/ics</code> - Diagnóstico ICS / Abate (Em desenvolvimento)</li>
      <li><code>/api/admin/*</code> - Painel Administrativo e Exportação</li>
    </ul>
  </body>
</html>`;
  }

  @Get("health")
  getHealth() {
    return {
      status: "ok",
      service: "cattle-vision-backend",
      runtime: "nestjs",
      version: "1.1.0",
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || "development",
    };
  }
}
