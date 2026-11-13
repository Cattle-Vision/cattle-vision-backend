-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Animal" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "breed" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "age" INTEGER NOT NULL,
    "length" DOUBLE PRECISION,
    "location" TEXT NOT NULL DEFAULT '',
    "locationAddress" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "observations" TEXT NOT NULL DEFAULT '',
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Animal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalCollaborator" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COLLABORATOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimalCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "view" TEXT NOT NULL DEFAULT 'REAR',
    "score" DOUBLE PRECISION,
    "icsStatus" TEXT NOT NULL DEFAULT 'IN_DEVELOPMENT',
    "icsScore" DOUBLE PRECISION,
    "icsClassification" TEXT,
    "slaughterReady" BOOLEAN,
    "slaughterStatus" TEXT NOT NULL DEFAULT 'IN_DEVELOPMENT',
    "slaughterReason" TEXT,
    "morphologicalFeatures" JSONB,
    "contourPoints" JSONB,
    "aiModelVersion" TEXT,
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaccineRecord" (
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

-- CreateTable
CREATE TABLE "DiseaseRecord" (
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

-- CreateTable
CREATE TABLE "AnimalLocationLog" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "reason" TEXT NOT NULL DEFAULT '',
    "movedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "movedById" INTEGER,

    CONSTRAINT "AnimalLocationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalObservation" (
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

-- CreateTable
CREATE TABLE "_cattle_migrations" (
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "_cattle_migrations_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Animal_ownerId_idx" ON "Animal"("ownerId");

-- CreateIndex
CREATE INDEX "Animal_ownerId_createdAt_idx" ON "Animal"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Animal_ownerId_tag_key" ON "Animal"("ownerId", "tag");

-- CreateIndex
CREATE INDEX "AnimalCollaborator_userId_idx" ON "AnimalCollaborator"("userId");

-- CreateIndex
CREATE INDEX "AnimalCollaborator_animalId_idx" ON "AnimalCollaborator"("animalId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimalCollaborator_animalId_userId_key" ON "AnimalCollaborator"("animalId", "userId");

-- CreateIndex
CREATE INDEX "Photo_animalId_idx" ON "Photo"("animalId");

-- CreateIndex
CREATE INDEX "Photo_animalId_createdAt_idx" ON "Photo"("animalId", "createdAt");

-- CreateIndex
CREATE INDEX "VaccineRecord_animalId_appliedAt_idx" ON "VaccineRecord"("animalId", "appliedAt");

-- CreateIndex
CREATE INDEX "DiseaseRecord_animalId_diagnosedAt_idx" ON "DiseaseRecord"("animalId", "diagnosedAt");

-- CreateIndex
CREATE INDEX "AnimalLocationLog_animalId_movedAt_idx" ON "AnimalLocationLog"("animalId", "movedAt");

-- CreateIndex
CREATE INDEX "AnimalObservation_animalId_observedAt_idx" ON "AnimalObservation"("animalId", "observedAt");

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalCollaborator" ADD CONSTRAINT "AnimalCollaborator_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalCollaborator" ADD CONSTRAINT "AnimalCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaccineRecord" ADD CONSTRAINT "VaccineRecord_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiseaseRecord" ADD CONSTRAINT "DiseaseRecord_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalLocationLog" ADD CONSTRAINT "AnimalLocationLog_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalObservation" ADD CONSTRAINT "AnimalObservation_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
