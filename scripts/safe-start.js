/**
 * Boot Seguro para Docker e Execução Local (`scripts/safe-start.js`).
 *
 * Nunca utiliza `prisma db push --force-reset` ou flags destrutivas:
 * 1. Garante pastas persistentes (`storage/uploads`, `backups`).
 * 2. Gera snapshot de backup JSON caso o banco já possua dados (`--best-effort`).
 * 3. Aplica apenas migrações versionadas pendentes via `prisma migrate deploy`.
 * 4. Inicia o servidor NestJS em modo dev (`--dev`) ou produção.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
require("./with-env");

const ROOT_DIR = path.resolve(__dirname, "..");
const IS_DEV = process.argv.includes("--dev");
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

fs.mkdirSync(path.join(ROOT_DIR, "storage", "uploads"), { recursive: true });
fs.mkdirSync(path.join(ROOT_DIR, "backups"), { recursive: true });

console.log("[safe-start] Verificando backup preventivo antes do deploy de migrações...");
spawnSync("node", ["scripts/db-backup.js", "--best-effort"], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

console.log("[safe-start] Aplicando migrações versionadas (prisma migrate deploy)...");
const migrateRes = spawnSync(npxCmd, ["prisma", "migrate", "deploy"], {
  cwd: ROOT_DIR,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});
if (migrateRes.status !== 0) {
  console.error("[safe-start] ERRO: Falha ao aplicar migrações versionadas. Boot abortado para proteger o banco.");
  process.exit(migrateRes.status ?? 1);
}

console.log(`[safe-start] Iniciando backend NestJS (${IS_DEV ? "dev" : "produção"})...`);
const appRes = IS_DEV
  ? spawnSync(npmCmd, ["run", "dev"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    })
  : spawnSync("node", ["dist/main.js"], {
      cwd: ROOT_DIR,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });

process.exit(appRes.status ?? 0);
