-- CreateIndex (aditivo, zero perda de dados)
CREATE INDEX IF NOT EXISTS "Animal_ownerId_createdAt_idx" ON "Animal"("ownerId", "createdAt");

-- CreateIndex (aditivo, zero perda de dados)
CREATE INDEX IF NOT EXISTS "Photo_animalId_createdAt_idx" ON "Photo"("animalId", "createdAt");
