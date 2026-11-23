-- CreateTable (aditivo e idempotente para a fila persistente de inferência ICS)
CREATE TABLE IF NOT EXISTS "IcsJob" (
    "id" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "requestedById" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IcsJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IcsJob_status_priority_createdAt_idx" ON "IcsJob"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IcsJob_photoId_status_idx" ON "IcsJob"("photoId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "IcsJob_animalId_status_idx" ON "IcsJob"("animalId", "status");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IcsJob_photoId_fkey') THEN
        ALTER TABLE "IcsJob" ADD CONSTRAINT "IcsJob_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IcsJob_animalId_fkey') THEN
        ALTER TABLE "IcsJob" ADD CONSTRAINT "IcsJob_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
