/**
 * Cliente Prisma Singleton (`src/lib/prisma.ts`).
 *
 * Decisões Arquiteturais:
 * - Resolve dinamicamente a URL de conexão a partir das variáveis injetadas pela Vercel
 *   (`DATA_POSTGRES_PRISMA_URL`, `POSTGRES_PRISMA_URL`, `DATABASE_URL`, `DATA_DATABASE_URL`)
 *   ou Docker local (`DATABASE_URL`).
 * - Reutiliza a instância em `globalThis` para evitar exaustão do pool de conexões
 *   durante Hot Reload (HMR) e invocação morna (warm starts) em Serverless Functions.
 */
import { PrismaClient } from "@prisma/client";

const resolvedDbUrl =
  process.env.DATA_POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.DATABASE_URL ||
  process.env.DATA_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/cattle_capture?schema=public";

if (resolvedDbUrl && !process.env.DATA_POSTGRES_PRISMA_URL) {
  process.env.DATA_POSTGRES_PRISMA_URL = resolvedDbUrl;
}

const resolvedDirectUrl =
  process.env.DATA_POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATA_DATABASE_URL_UNPOOLED ||
  resolvedDbUrl;

if (resolvedDirectUrl && !process.env.DATA_POSTGRES_URL_NON_POOLING) {
  process.env.DATA_POSTGRES_URL_NON_POOLING = resolvedDirectUrl;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
