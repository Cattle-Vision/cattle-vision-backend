/**
 * Carrega `.env` e `.env.local` (sem sobrescrever variáveis já definidas no ambiente/Docker)
 * e executa qualquer comando filho com as variáveis disponíveis (ex.: Prisma CLI).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function parseAndLoadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
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

const rootDir = path.resolve(__dirname, "..");
parseAndLoadEnv(path.join(rootDir, ".env"));
parseAndLoadEnv(path.join(rootDir, ".env.local"));

// Garante espelhamento idêntico ao bootstrapEnv() caso apenas uma URL esteja definida
if (!process.env.DATA_POSTGRES_PRISMA_URL && process.env.DATABASE_URL) {
  process.env.DATA_POSTGRES_PRISMA_URL = process.env.DATABASE_URL;
}
if (!process.env.DATA_POSTGRES_URL_NON_POOLING) {
  process.env.DATA_POSTGRES_URL_NON_POOLING =
    process.env.DIRECT_URL ||
    process.env.DATA_POSTGRES_URL ||
    process.env.DATA_POSTGRES_PRISMA_URL ||
    "";
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const [cmd, ...rest] = args;
    const result = spawnSync(cmd, rest, {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    process.exit(result.status ?? 1);
  }
}
