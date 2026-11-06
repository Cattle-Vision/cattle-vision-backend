/**
 * Seed e Migração de Dados do Banco (`prisma/seed.ts`).
 *
 * Responsabilidades:
 * 1. Provisionar ou atualizar o usuário Administrador a partir das variáveis
 *    definidas no `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`).
 * 2. Aplicar de forma idempotente a migração de calibração dos scores de IA
 *    (`100.0 - score`) para todas as fotos existentes no banco de dados atual.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@cattlecapture.com").trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const adminName = process.env.ADMIN_NAME || "Administrador do Sistema";

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      password: hashedPassword,
      role: "ADMIN",
    },
    create: {
      name: adminName,
      email: adminEmail,
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  console.log("✅ Admin provisionado via .env com sucesso:", admin.email);

  // Migração idempotente das porcentagens existentes no banco (100 - score)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_cattle_migrations" (
      "name" TEXT NOT NULL,
      "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "_cattle_migrations_pkey" PRIMARY KEY ("name")
    );
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM "_cattle_migrations" WHERE "name" = '20261016150000_invert_ai_scores'
      ) THEN
        UPDATE "Photo"
        SET "score" = ROUND((100.0 - "score")::numeric, 1)::double precision
        WHERE "score" IS NOT NULL
          AND "score" >= 0
          AND "score" <= 100;

        INSERT INTO "_cattle_migrations" ("name")
        VALUES ('20261016150000_invert_ai_scores');
      END IF;
    END $$;
  `);

  console.log("✅ Porcentagens de Score IA no banco atualizadas (100 - score) com sucesso!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
