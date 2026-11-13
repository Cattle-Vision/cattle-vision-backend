import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

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
  canManage: boolean;
  owner: CustodyUser;
  collaborators: AnimalCollaboratorRecord[];
}

/**
 * Serviço de Guarda Compartilhada e Custódia (`src/modules/animals/custody.service.ts`).
 */
@Injectable()
export class CustodyService {
  private tableEnsured = false;
  private ensurePromise: Promise<void> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ensureCustodyTable(): Promise<void> {
    if (this.tableEnsured) return;
    if (this.ensurePromise) return this.ensurePromise;

    this.ensurePromise = (async () => {
      try {
        const existing = await this.prisma.$queryRaw<Array<{ reg: string | null }>>`
          SELECT to_regclass('"AnimalCollaborator"')::text AS reg
        `;
        if (existing?.[0]?.reg) {
          this.tableEnsured = true;
          return;
        }

        await this.prisma.$executeRawUnsafe(`
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

        await this.prisma.$executeRawUnsafe(`
          CREATE UNIQUE INDEX IF NOT EXISTS "AnimalCollaborator_animalId_userId_key" ON "AnimalCollaborator"("animalId", "userId")
        `);
        await this.prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "AnimalCollaborator_userId_idx" ON "AnimalCollaborator"("userId")
        `);
        await this.prisma.$executeRawUnsafe(`
          CREATE INDEX IF NOT EXISTS "AnimalCollaborator_animalId_idx" ON "AnimalCollaborator"("animalId")
        `);
        this.tableEnsured = true;
      } catch (err) {
        console.warn("[custody] ensureCustodyTable warning:", err);
      } finally {
        this.ensurePromise = null;
      }
    })();

    return this.ensurePromise;
  }

  async canAccessAnimal(
    animalId: string,
    ownerId: number,
    userId: number,
    isAdmin: boolean
  ): Promise<boolean> {
    if (isAdmin || ownerId === userId) return true;
    await this.ensureCustodyTable();
    try {
      const collab = await this.prisma.animalCollaborator.findUnique({
        where: { animalId_userId: { animalId, userId } },
        select: { id: true },
      });
      return Boolean(collab);
    } catch {
      return false;
    }
  }

  async getAccessibleAnimalIds(
    userId: number,
    isAdmin: boolean
  ): Promise<{ ownedIds: string[]; sharedIds: string[] }> {
    await this.ensureCustodyTable();

    if (isAdmin) {
      const all = await this.prisma.animal.findMany({ select: { id: true } });
      return { ownedIds: all.map((a) => a.id), sharedIds: [] };
    }

    const [owned, sharedRecords] = await Promise.all([
      this.prisma.animal.findMany({
        where: { ownerId: userId },
        select: { id: true },
      }),
      this.prisma.animalCollaborator
        .findMany({
          where: { userId },
          select: { animalId: true },
        })
        .catch(() => [] as Array<{ animalId: string }>),
    ]);

    return {
      ownedIds: owned.map((o) => o.id),
      sharedIds: sharedRecords.map((r) => r.animalId),
    };
  }

  async addCollaborator(
    animalId: string,
    userId: number
  ): Promise<{ added: boolean; message: string }> {
    await this.ensureCustodyTable();

    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      select: { id: true, ownerId: true },
    });

    if (!animal) {
      return { added: false, message: "Animal não encontrado" };
    }
    if (animal.ownerId === userId) {
      return { added: false, message: "Usuário já é o proprietário principal" };
    }

    try {
      await this.prisma.animalCollaborator.upsert({
        where: { animalId_userId: { animalId, userId } },
        update: {},
        create: {
          id: `collab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          animalId,
          userId,
          role: "COLLABORATOR",
        },
      });
      return { added: true, message: "Guarda compartilhada ativada com sucesso" };
    } catch (err) {
      console.error("[custody] addCollaborator error:", err);
      return {
        added: false,
        message: err instanceof Error ? err.message : "Erro ao conceder guarda compartilhada",
      };
    }
  }

  async removeCollaborator(
    animalId: string,
    targetUserId: number,
    requestingUserId: number,
    isAdmin: boolean
  ): Promise<{ success: boolean; message: string }> {
    await this.ensureCustodyTable();

    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      select: { id: true, ownerId: true },
    });

    if (!animal) {
      return { success: false, message: "Animal não encontrado" };
    }
    if (animal.ownerId !== requestingUserId && !isAdmin) {
      return {
        success: false,
        message: "Apenas o proprietário principal pode revogar acessos",
      };
    }

    try {
      await this.prisma.animalCollaborator.deleteMany({
        where: { animalId, userId: targetUserId },
      });
      return {
        success: true,
        message: "Acesso de guarda compartilhada revogado com sucesso",
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Erro ao remover colaborador",
      };
    }
  }

  async transferOwnership(
    animalId: string,
    newOwnerId: number,
    requestingUserId: number,
    isAdmin: boolean
  ): Promise<{ success: boolean; message: string }> {
    await this.ensureCustodyTable();

    const animal = await this.prisma.animal.findUnique({
      where: { id: animalId },
      select: { id: true, ownerId: true },
    });

    if (!animal) {
      return { success: false, message: "Animal não encontrado" };
    }
    if (animal.ownerId !== requestingUserId && !isAdmin) {
      return {
        success: false,
        message: "Apenas o proprietário principal pode transferir a guarda definitiva",
      };
    }

    const previousOwnerId = animal.ownerId;

    await this.prisma.animal.update({
      where: { id: animalId },
      data: { ownerId: newOwnerId },
    });

    await this.prisma.animalCollaborator
      .deleteMany({
        where: { animalId, userId: newOwnerId },
      })
      .catch(() => {});

    await this.addCollaborator(animalId, previousOwnerId);

    return { success: true, message: "Guarda definitiva transferida com sucesso!" };
  }

  async getCustodyDetails(
    animalId: string,
    ownerId: number,
    currentUserId: number,
    isAdmin: boolean
  ): Promise<CustodyInfo> {
    await this.ensureCustodyTable();

    const isOwner = ownerId === currentUserId;
    const canManage = isOwner || isAdmin;

    const [ownerRecord, collabRows] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { id: true, name: true, email: true },
      }),
      this.prisma.animalCollaborator
        .findMany({
          where: { animalId },
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        })
        .catch(() => []),
    ]);

    const owner: CustodyUser = ownerRecord || {
      id: ownerId,
      name: "Proprietário",
      email: "proprietario@fazenda.com",
    };

    const collaborators: AnimalCollaboratorRecord[] = collabRows.map((r) => ({
      id: r.id,
      animalId: r.animalId,
      userId: r.userId,
      role: r.role,
      createdAt: r.createdAt.toISOString(),
      user: {
        id: r.user.id,
        name: r.user.name || "Operador",
        email: r.user.email || "",
      },
    }));

    const isCollaborator = collaborators.some((c) => c.userId === currentUserId);

    return {
      isOwner,
      isCollaborator,
      canManage,
      owner,
      collaborators,
    };
  }
}
