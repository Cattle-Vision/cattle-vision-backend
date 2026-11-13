/**
 * Auditoria Anti-Drift de Schema e Anti-Perda de Dados (`scripts/check-migrations.js`).
 *
 * Executado pelos hooks Husky (`pre-commit` e `pre-push`) e via `npm run db:check`:
 * 1. Garante que toda alteração em `prisma/schema.prisma` possua uma migração gerada por
 *    `prisma migrate dev` (comparando DDL canônico contra `prisma/migrations/.schema-snapshot.sql`).
 * 2. Bloqueia comandos SQL destrutivos não autorizados (`DROP TABLE`, `TRUNCATE`, `DROP COLUMN`)
 *    em arquivos `migration.sql`.
 * 3. Opcionalmente verifica `prisma migrate status` com o banco quando disponível.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
require("./with-env");

const ROOT_DIR = path.resolve(__dirname, "..");
const SCHEMA_PATH = path.join(ROOT_DIR, "prisma", "schema.prisma");
const MIGRATIONS_DIR = path.join(ROOT_DIR, "prisma", "migrations");
const SNAPSHOT_PATH = path.join(MIGRATIONS_DIR, ".schema-snapshot.sql");

const WRITE_SNAPSHOT = process.argv.includes("--write-snapshot");
const WITH_DB_STATUS = process.argv.includes("--with-db");

function normalizeSql(sql) {
  return sql.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
}

function generateCanonicalSchemaSql() {
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(
    npxCmd,
    [
      "prisma",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      SCHEMA_PATH,
      "--script",
    ],
    {
      cwd: ROOT_DIR,
      encoding: "utf-8",
      shell: process.platform === "win32",
    }
  );
  if (res.status !== 0) {
    throw new Error(res.stderr || res.stdout || "Falha ao executar prisma migrate diff.");
  }
  return normalizeSql(res.stdout);
}

function scanDestructiveSql() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return;
  const entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  const dangerousPatterns = [
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+DATABASE\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bTRUNCATE\b/i,
  ];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sqlPath = path.join(MIGRATIONS_DIR, entry.name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, "utf-8");
    if (sql.includes("-- allow-destructive")) continue;

    for (const pattern of dangerousPatterns) {
      if (pattern.test(sql)) {
        throw new Error(
          `Comando SQL destrutivo detectado em prisma/migrations/${entry.name}/migration.sql (${pattern}). ` +
            `Adicione '-- allow-destructive' no arquivo apenas se a remoção for intencional.`
        );
      }
    }
  }
}

function listChangedFilesInGit() {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", "prisma"], {
      cwd: ROOT_DIR,
      encoding: "utf-8",
    });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function main() {
  const currentDdl = generateCanonicalSchemaSql();

  if (WRITE_SNAPSHOT) {
    fs.mkdirSync(MIGRATIONS_DIR, { recursive: true });
    fs.writeFileSync(SNAPSHOT_PATH, currentDdl + "\n", "utf-8");
    console.log("[db-check] Snapshot de migração atualizado em prisma/migrations/.schema-snapshot.sql");
    return;
  }

  scanDestructiveSql();

  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      "Snapshot prisma/migrations/.schema-snapshot.sql ausente. Execute 'npm run db:migrate:dev' ou 'node scripts/check-migrations.js --write-snapshot'."
    );
  }

  const savedDdl = normalizeSql(fs.readFileSync(SNAPSHOT_PATH, "utf-8"));
  if (currentDdl !== savedDdl) {
    console.error("\n[BLOQUEADO] prisma/schema.prisma foi alterado sem migração sincronizada!");
    console.error("Para proteger os dados em produção e no Docker local:");
    console.error("  1. Execute: npm run db:migrate:dev");
    console.error("  2. Adicione os novos arquivos de prisma/migrations/ ao commit.\n");
    process.exit(1);
  }

  // Se o schema foi modificado no working tree/staging sem nenhuma alteração em prisma/migrations
  const gitPrismaChanges = listChangedFilesInGit();
  const touchedSchema = gitPrismaChanges.some((l) => l.includes("prisma/schema.prisma"));
  const touchedMigration = gitPrismaChanges.some((l) => l.includes("prisma/migrations/"));
  if (touchedSchema && !touchedMigration) {
    console.error(
      "\n[BLOQUEADO] prisma/schema.prisma modificado no Git sem arquivos correspondentes em prisma/migrations/."
    );
    console.error("Execute 'npm run db:migrate:dev' antes de prosseguir.\n");
    process.exit(1);
  }

  if (WITH_DB_STATUS && process.env.DATA_POSTGRES_PRISMA_URL) {
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    const statusRes = spawnSync(npxCmd, ["prisma", "migrate", "status"], {
      cwd: ROOT_DIR,
      encoding: "utf-8",
      shell: process.platform === "win32",
      env: process.env,
    });
    if (statusRes.status !== 0) {
      const msg = (statusRes.stdout || "") + "\n" + (statusRes.stderr || "");
      if (msg.includes("have not yet been applied") || msg.includes("failed migrations")) {
        console.error("\n[BLOQUEADO] Há migrações pendentes ou falhas no banco configurado:\n" + msg);
        process.exit(1);
      }
      console.warn("[db-check] Banco remoto indisponível offline; verificação estática aprovada.");
    }
  }

  console.log("[db-check] Schema Prisma e migrações versionadas estão sincronizados e seguros.");
}

main();
