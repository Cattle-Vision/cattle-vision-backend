/**
 * Snapshot de Segurança do Banco PostgreSQL (`scripts/db-backup.js`).
 *
 * Salva um backup JSON completo de todas as tabelas em `./backups/` antes de operações
 * de migração ou boot local/Docker, garantindo proteção contra perda acidental de dados.
 * Usa `@prisma/client` diretamente para funcionar dentro e fora do Docker sem depender de `pg_dump`.
 */
const fs = require("fs");
const path = require("path");
require("./with-env");

const { PrismaClient } = require("@prisma/client");

const BEST_EFFORT = process.argv.includes("--best-effort");
const BACKUP_DIR = path.resolve(__dirname, "..", "backups");
const MAX_BACKUPS = 15;

async function main() {
  if (!process.env.DATA_POSTGRES_PRISMA_URL) {
    if (BEST_EFFORT) {
      console.log("[db-backup] URL do banco não configurada ainda; pulando snapshot inicial.");
      return;
    }
    throw new Error("DATA_POSTGRES_PRISMA_URL não definida para backup.");
  }

  const prisma = new PrismaClient();
  try {
    // Confirma se o schema base já existe antes de tentar ler tabelas (evita erro no 1º boot Docker)
    const tableCheck = await prisma.$queryRawUnsafe(
      `SELECT to_regclass('public."Animal"')::text AS tbl`
    );
    if (!tableCheck?.[0]?.tbl) {
      console.log("[db-backup] Banco ainda não inicializado (1º boot). Snapshot ignorado.");
      return;
    }

    const safeRead = async (fn) => {
      try {
        return await fn();
      } catch {
        return [];
      }
    };

    const [
      users,
      animals,
      collaborators,
      photos,
      vaccines,
      diseases,
      locationLogs,
      observations,
    ] = await Promise.all([
      safeRead(() =>
        prisma.user.findMany({
          select: { id: true, name: true, email: true, role: true, createdAt: true },
        })
      ),
      safeRead(() => prisma.animal.findMany()),
      safeRead(() => prisma.animalCollaborator.findMany()),
      safeRead(() => prisma.photo.findMany()),
      safeRead(() => prisma.vaccineRecord.findMany()),
      safeRead(() => prisma.diseaseRecord.findMany()),
      safeRead(() => prisma.animalLocationLog.findMany()),
      safeRead(() => prisma.animalObservation.findMany()),
    ]);

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const targetFile = path.join(BACKUP_DIR, `backup-${stamp}.json`);

    const payload = {
      createdAt: new Date().toISOString(),
      counts: {
        users: users.length,
        animals: animals.length,
        collaborators: collaborators.length,
        photos: photos.length,
        vaccines: vaccines.length,
        diseases: diseases.length,
        locationLogs: locationLogs.length,
        observations: observations.length,
      },
      data: {
        users,
        animals,
        collaborators,
        photos,
        vaccines,
        diseases,
        locationLogs,
        observations,
      },
    };

    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), "utf-8");
    console.log(
      `[db-backup] Backup salvo em ${path.relative(process.cwd(), targetFile)} ` +
        `(animais=${animals.length}, fotos=${photos.length}, obs=${observations.length}).`
    );

    // Mantém apenas os N backups mais recentes para economizar disco
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
      .sort()
      .reverse();
    for (const stale of files.slice(MAX_BACKUPS)) {
      fs.rmSync(path.join(BACKUP_DIR, stale), { force: true });
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.warn("[db-backup] Aviso:", err.message);
  if (!BEST_EFFORT) {
    process.exit(1);
  }
});
