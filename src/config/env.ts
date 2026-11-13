/**
 * Carregador de Variáveis de Ambiente (`src/config/env.ts`).
 *
 * Responsabilidades:
 * - Carregar `.env.local` e `.env` em desenvolvimento local mantendo paridade com o comportamento
 *   que o Next.js tinha anteriormente, sem sobrescrever variáveis já definidas no ambiente.
 * - Resolver aliases de URLs PostgreSQL (`POSTGRES_PRISMA_URL`, `DATABASE_URL`, `DATA_POSTGRES_PRISMA_URL`)
 *   antes da inicialização do `PrismaClient`.
 */
import fs from "fs";
import path from "path";

let envLoaded = false;

function parseAndInjectEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  // Node >= 20.12 disponibiliza process.loadEnvFile, mas preservamos leitura manual
  // para não sobrescrever variáveis já presentes em process.env.
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function bootstrapEnv(): void {
  if (envLoaded) return;
  envLoaded = true;

  const cwd = process.cwd();
  parseAndInjectEnvFile(path.join(cwd, ".env.local"));
  parseAndInjectEnvFile(path.join(cwd, ".env"));

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
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATA_DATABASE_URL_UNPOOLED ||
    resolvedDbUrl;

  if (resolvedDirectUrl && !process.env.DATA_POSTGRES_URL_NON_POOLING) {
    process.env.DATA_POSTGRES_URL_NON_POOLING = resolvedDirectUrl;
  }
}
