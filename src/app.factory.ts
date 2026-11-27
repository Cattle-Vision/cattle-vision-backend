import "reflect-metadata";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import express, { Express } from "express";
import { bootstrapEnv } from "./config/env";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { vercelAnalyticsMiddleware } from "./common/utils/analytics";
import { AppModule } from "./app.module";

/**
 * Factory Compartilhada da Aplicação NestJS (`src/app.factory.ts`).
 *
 * Utilizada tanto pelo servidor HTTP standalone (`src/main.ts` -> Node / Docker)
 * quanto pelo adaptador Serverless da Vercel (`api/index.ts`), garantindo paridade
 * de CORS, prefixo `/api`, parser de 15MB e filtro padronizado de erros.
 */
export async function createConfiguredNestApp(): Promise<{
  expressApp: Express;
}> {
  bootstrapEnv();

  const expressApp = express();
  expressApp.use(express.json({ limit: "15mb" }));
  expressApp.use(express.urlencoded({ extended: true, limit: "15mb" }));
  expressApp.use(vercelAnalyticsMiddleware);
  // Evita cache HTTP intermediário/browser em respostas dinâmicas JSON (mantém cache imutável em GET /api/photos/:id)
  expressApp.use((req, res, next) => {
    const rawPath = (req.path || req.url || "").split("?")[0];
    if (
      req.method === "GET" &&
      rawPath.startsWith("/api/") &&
      !/^\/api\/photos\/[^/]+$/.test(rawPath)
    ) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    }
    next();
  });

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    bodyParser: false,
    logger: process.env.NODE_ENV === "production" ? ["error", "warn", "log"] : ["error", "warn", "log"],
  });

  const allowedConfig = (process.env.CORS_ORIGIN || "*").trim();
  const allowedOrigins =
    allowedConfig === "*"
      ? null
      : allowedConfig.split(",").map((o) => o.trim().toLowerCase()).filter(Boolean);

  app.enableCors({
    origin: (origin, callback) => {
      if (!allowedOrigins || !origin) {
        callback(null, true);
        return;
      }
      callback(null, allowedOrigins.includes(origin.toLowerCase()));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "X-CSRF-Token",
      "X-Requested-With",
      "Accept",
      "Accept-Version",
      "Content-Length",
      "Content-MD5",
      "Content-Type",
      "Date",
      "X-Api-Version",
      "Authorization",
    ],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  });

  app.setGlobalPrefix("api", {
    exclude: [
      { path: "", method: RequestMethod.GET },
      { path: "/", method: RequestMethod.GET },
    ],
  });

  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
    })
  );

  await app.init();
  return { expressApp };
}
