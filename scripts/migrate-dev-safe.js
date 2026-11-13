/**
 * Executor Seguro de `prisma migrate dev` (`scripts/migrate-dev-safe.js`).
 *
 * 1. Cria backup JSON automático em `./backups/` antes de alterar o banco.
 * 2. Carrega `.env` e `.env.local` com fallback automático de `DATA_POSTGRES_URL_NON_POOLING`.
 * 3. Executa `prisma migrate dev` sem jamais usar flags destrutivas (`--force-reset`).
 * 4. Atualiza `prisma/migrations/.schema-snapshot.sql` e regenera o Prisma Client.
 */
const path = require("path");
const { spawnSync } = require("child_process");
require("./with-env");

const ROOT_DIR = path.resolve(__dirname, "..");
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

function runOrFail(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

console.log("[migrate-dev-safe] 1/4 Executando backup preventivo dos dados atuais...");
runOrFail("node", ["scripts/db-backup.js", "--best-effort"]);

console.log("[migrate-dev-safe] 2/4 Executando prisma migrate dev...");
const extraArgs = process.argv.slice(2);
runOrFail(npxCmd, ["prisma", "migrate", "dev", ...extraArgs]);

console.log("[migrate-dev-safe] 3/4 Atualizando snapshot canônico para os hooks Husky...");
runOrFail("node", ["scripts/check-migrations.js", "--write-snapshot"]);

console.log("[migrate-dev-safe] 4/4 Regenerando Prisma Client...");
runOrFail(npxCmd, ["prisma", "generate"]);
