/**
 * Módulo de Guarda Compartilhada e Gestão de Custódia de Animais (`src/lib/custody.ts`).
 *
 * Filosofia:
 * - O primeiro operador a registrar uma tag RFID torna-se o Dono Principal (`ownerId`).
 * - Quando outro operador lê a mesma tag via Bluetooth ESP32 ou busca no sistema,
 *   uma "Guarda Compartilhada" é automaticamente atribuída a ele.
 * - Todos os operadores com guarda compartilhada podem visualizar fotos, enviar novas fotos
 *   e acompanhar o Índice de Condição Corporal (ICS).
 * - O Dono Principal tem o poder exclusivo de remover colaboradores da guarda compartilhada
 *   ou transferir a guarda completa (propriedade principal) para outro operador.
 */
import { prisma } from "@/lib/prisma";

let tableEnsured = false;

/**
 * Cria a tabela de guarda compartilhada de forma idempotente e autônoma,
 * executando cada instrução DDL isoladamente para compatibilidade universal com Neon/pgBouncer.
 */
export async function ensureCustodyTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AnimalCollaborator" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "animalId" TEXT NOT NULL,
        "userId" INTEGER NOT NULL,
        "role" TEXT NOT NULL DEFAULT 'COLLABORATOR',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AnimalCollaborator_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "AnimalCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "AnimalCollaborator_animalId_userId_key" ON "AnimalCollaborator"("animalId", "userId")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AnimalCollaborator_userId_idx" ON "AnimalCollaborator"("userId")
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "AnimalCollaborator_animalId_idx" ON "AnimalCollaborator"("animalId")
    `);

    tableEnsured = true;
  } catch (err) {
    console.warn("[custody] ensureCustodyTable warning:", err);
  }
}

export interface CustodyUser {
  id: number;
  name: string;
  email: string;
}

export interface AnimalCollaboratorRecord {
  id: string;
  animalId: string;
  userId: number;
  role: string;
  createdAt: string;
  user: CustodyUser;
}

export interface CustodyInfo {
  isOwner: boolean;
  isCollaborator: boolean;
  canManage: boolean; // Pode remover colaboradores ou transferir posse
  owner: CustodyUser;
  collaborators: AnimalCollaboratorRecord[];
}

/**
 * Verifica se o usuário tem permissão de acesso ao animal (Dono, Admin ou Colaborador).
 */
export async function canAccessAnimal(
  animalId: string,
  ownerId: number,
  userId: number,
  isAdmin: boolean
): Promise<boolean> {
  if (isAdmin || ownerId === userId) return true;
  await ensureCustodyTable();
  try {
    const records = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "AnimalCollaborator" WHERE "animalId" = ${animalId} AND "userId" = ${userId} LIMIT 1
    `;
    return Boolean(records && records.length > 0);
  } catch {
    return false;
  }
}

/**
 * Retorna os identificadores dos animais que o usuário tem acesso (próprios + guarda compartilhada).
 */
export async function getAccessibleAnimalIds(userId: number, isAdmin: boolean): Promise<{
  ownedIds: string[];
  sharedIds: string[];
}> {
  await ensureCustodyTable();

  if (isAdmin) {
    const all = await prisma.animal.findMany({ select: { id: true } });
    return { ownedIds: all.map((a) => a.id), sharedIds: [] };
  }

  const owned = await prisma.animal.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });

  let sharedIds: string[] = [];
  try {
    const sharedRecords = await prisma.$queryRaw<Array<{ animalId: string }>>`
      SELECT "animalId" FROM "AnimalCollaborator" WHERE "userId" = ${userId}
    `;
    sharedIds = (sharedRecords || []).map((r) => r.animalId);
  } catch {
    sharedIds = [];
  }

  return {
    ownedIds: owned.map((o) => o.id),
    sharedIds,
  };
}

/**
 * Adiciona um operador à guarda compartilhada do animal (se já não for o dono ou já adicionado).
 */
export async function addCollaborator(
  animalId: string,
  userId: number
): Promise<{ added: boolean; message: string }> {
  await ensureCustodyTable();

  const animal = await prisma.animal.findUnique({
    where: { id: animalId },
    select: { id: true, ownerId: true },
  });

  if (!animal) {
    return { added: false, message: "Animal não encontrado" };
  }

  // O dono principal já tem guarda completa
  if (animal.ownerId === userId) {
    return { added: false, message: "Usuário já é o proprietário principal" };
  }

  try {
    const randomId = `collab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    await prisma.$executeRaw`
      INSERT INTO "AnimalCollaborator" ("id", "animalId", "userId", "role", "createdAt")
      VALUES (${randomId}, ${animalId}, ${userId}, 'COLLABORATOR', NOW())
      ON CONFLICT ("animalId", "userId") DO NOTHING
    `;
    return { added: true, message: "Guarda compartilhada ativada com sucesso" };
  } catch (err: any) {
    console.error("[custody] addCollaborator error:", err);
    return { added: false, message: err?.message || "Erro ao conceder guarda compartilhada" };
  }
}

/**
 * Remove um operador da guarda compartilhada (ação do Dono Principal ou Admin).
 */
export async function removeCollaborator(
  animalId: string,
  targetUserId: number,
  requestingUserId: number,
  isAdmin: boolean
): Promise<{ success: boolean; message: string }> {
  await ensureCustodyTable();

  const animal = await prisma.animal.findUnique({
    where: { id: animalId },
    select: { id: true, ownerId: true },
  });

  if (!animal) {
    return { success: false, message: "Animal não encontrado" };
  }

  // Apenas o dono principal ou administrador pode revogar acessos
  if (animal.ownerId !== requestingUserId && !isAdmin) {
    return { success: false, message: "Apenas o proprietário principal pode revogar acessos" };
  }

  try {
    await prisma.$executeRaw`
      DELETE FROM "AnimalCollaborator" WHERE "animalId" = ${animalId} AND "userId" = ${targetUserId}
    `;
    return { success: true, message: "Acesso de guarda compartilhada revogado com sucesso" };
  } catch (err: any) {
    return { success: false, message: err?.message || "Erro ao remover colaborador" };
  }
}

/**
 * Transfere a guarda definitiva / propriedade principal do animal para outro usuário.
 * O dono anterior é mantido como colaborador da guarda compartilhada.
 */
export async function transferOwnership(
  animalId: string,
  newOwnerId: number,
  requestingUserId: number,
  isAdmin: boolean
): Promise<{ success: boolean; message: string }> {
  await ensureCustodyTable();

  const animal = await prisma.animal.findUnique({
    where: { id: animalId },
    select: { id: true, ownerId: true, tag: true },
  });

  if (!animal) {
    return { success: false, message: "Animal não encontrado" };
  }

  if (animal.ownerId !== requestingUserId && !isAdmin) {
    return { success: false, message: "Apenas o proprietário principal pode transferir a guarda definitiva" };
  }

  const previousOwnerId = animal.ownerId;

  // Atualiza o proprietário na tabela principal
  await prisma.animal.update({
    where: { id: animalId },
    data: { ownerId: newOwnerId },
  });

  // Remove o novo proprietário da lista de colaboradores (já que agora ele é o dono)
  try {
    await prisma.$executeRaw`
      DELETE FROM "AnimalCollaborator" WHERE "animalId" = ${animalId} AND "userId" = ${newOwnerId}
    `;
  } catch {}

  // Insere o antigo dono como colaborador na guarda compartilhada para não perder o histórico
  await addCollaborator(animalId, previousOwnerId);

  return { success: true, message: "Guarda definitiva transferida com sucesso!" };
}

/**
 * Recupera informações detalhadas de custódia e colaboradores de um animal.
 */
export async function getCustodyDetails(
  animalId: string,
  ownerId: number,
  currentUserId: number,
  isAdmin: boolean
): Promise<CustodyInfo> {
  await ensureCustodyTable();

  const isOwner = ownerId === currentUserId;
  const canManage = isOwner || isAdmin;

  // Busca dados do proprietário
  const ownerRecord = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, name: true, email: true },
  });

  const owner: CustodyUser = ownerRecord || {
    id: ownerId,
    name: "Proprietário",
    email: "proprietario@fazenda.com",
  };

  // Busca colaboradores
  let collaborators: AnimalCollaboratorRecord[] = [];
  try {
    const rawCollaborators = await prisma.$queryRaw<
      Array<{
        id: string;
        animalId: string;
        userId: number;
        role: string;
        createdAt: Date;
        userName: string;
        userEmail: string;
      }>
    >`
      SELECT c."id", c."animalId", c."userId", c."role", c."createdAt",
             u."name" as "userName", u."email" as "userEmail"
      FROM "AnimalCollaborator" c
      INNER JOIN "User" u ON u."id" = c."userId"
      WHERE c."animalId" = ${animalId}
      ORDER BY c."createdAt" ASC
    `;

    collaborators = (rawCollaborators || []).map((r) => ({
      id: r.id,
      animalId: r.animalId,
      userId: r.userId,
      role: r.role,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      user: {
        id: r.userId,
        name: r.userName || "Operador",
        email: r.userEmail || "",
      },
    }));
  } catch (err) {
    collaborators = [];
  }

  const isCollaborator = collaborators.some((c) => c.userId === currentUserId);

  return {
    isOwner,
    isCollaborator,
    canManage,
    owner,
    collaborators,
  };
}
