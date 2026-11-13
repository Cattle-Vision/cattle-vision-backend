-- Migração aditiva consolidando as extensões de domínio do SRS e Observações Gerais
-- (mantém 100% compatibilidade com dados já existentes via IF NOT EXISTS)

-- AlterTable: Animal
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "length" DOUBLE PRECISION;
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "location" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Animal" ADD COLUMN IF NOT EXISTS "observations" TEXT NOT NULL DEFAULT '';

-- AlterTable: Photo (Campos ICS / Contorno / Aptidão para Abate - módulo futuro)
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "icsStatus" TEXT NOT NULL DEFAULT 'IN_DEVELOPMENT';
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "icsScore" DOUBLE PRECISION;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "icsClassification" TEXT;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "slaughterReady" BOOLEAN;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "slaughterStatus" TEXT NOT NULL DEFAULT 'IN_DEVELOPMENT';
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "slaughterReason" TEXT;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "morphologicalFeatures" JSONB;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "contourPoints" JSONB;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "aiModelVersion" TEXT;
ALTER TABLE "Photo" ADD COLUMN IF NOT EXISTS "evaluatedAt" TIMESTAMP(3);

-- CreateTable: AnimalCollaborator
CREATE TABLE IF NOT EXISTS "AnimalCollaborator" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COLLABORATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimalCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable: VaccineRecord
CREATE TABLE IF NOT EXISTS "VaccineRecord" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dose" TEXT NOT NULL DEFAULT '',
    "batch" TEXT NOT NULL DEFAULT '',
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "nextDueAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaccineRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DiseaseRecord
CREATE TABLE IF NOT EXISTS "DiseaseRecord" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symptoms" TEXT NOT NULL DEFAULT '',
    "treatment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "diagnosedAt" TIMESTAMP(3) NOT NULL,
    "recoveredAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiseaseRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AnimalLocationLog
CREATE TABLE IF NOT EXISTS "AnimalLocationLog" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedById" INTEGER,

    CONSTRAINT "AnimalLocationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AnimalObservation
CREATE TABLE IF NOT EXISTS "AnimalObservation" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GERAL',
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimalObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: _cattle_migrations
CREATE TABLE IF NOT EXISTS "_cattle_migrations" (
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_cattle_migrations_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AnimalCollaborator_userId_idx" ON "AnimalCollaborator"("userId");
CREATE INDEX IF NOT EXISTS "AnimalCollaborator_animalId_idx" ON "AnimalCollaborator"("animalId");
CREATE UNIQUE INDEX IF NOT EXISTS "AnimalCollaborator_animalId_userId_key" ON "AnimalCollaborator"("animalId", "userId");
CREATE INDEX IF NOT EXISTS "VaccineRecord_animalId_appliedAt_idx" ON "VaccineRecord"("animalId", "appliedAt");
CREATE INDEX IF NOT EXISTS "DiseaseRecord_animalId_diagnosedAt_idx" ON "DiseaseRecord"("animalId", "diagnosedAt");
CREATE INDEX IF NOT EXISTS "AnimalLocationLog_animalId_movedAt_idx" ON "AnimalLocationLog"("animalId", "movedAt");
CREATE INDEX IF NOT EXISTS "AnimalObservation_animalId_observedAt_idx" ON "AnimalObservation"("animalId", "observedAt");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnimalCollaborator_animalId_fkey') THEN
        ALTER TABLE "AnimalCollaborator" ADD CONSTRAINT "AnimalCollaborator_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnimalCollaborator_userId_fkey') THEN
        ALTER TABLE "AnimalCollaborator" ADD CONSTRAINT "AnimalCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VaccineRecord_animalId_fkey') THEN
        ALTER TABLE "VaccineRecord" ADD CONSTRAINT "VaccineRecord_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DiseaseRecord_animalId_fkey') THEN
        ALTER TABLE "DiseaseRecord" ADD CONSTRAINT "DiseaseRecord_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnimalLocationLog_animalId_fkey') THEN
        ALTER TABLE "AnimalLocationLog" ADD CONSTRAINT "AnimalLocationLog_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AnimalObservation_animalId_fkey') THEN
        ALTER TABLE "AnimalObservation" ADD CONSTRAINT "AnimalObservation_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
