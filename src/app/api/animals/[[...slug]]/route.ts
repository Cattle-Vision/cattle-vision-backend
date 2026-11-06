/**
 * API de Gestão de Animais e Guarda Compartilhada (`src/app/api/animals/[[...slug]]/route.ts`).
 *
 * Funcionalidades:
 * - GET /api/animals: lista animais do operador (próprios + sob guarda compartilhada) ou busca por ?tag=...
 * - GET /api/animals/[id]: retorna detalhes completos do animal, fotos e status de custódia (Dono vs Guarda Compartilhada).
 * - POST /api/animals/rfid-scan: leitura automática de tag RFID (ESP32 Bluetooth ou manual).
 *   - Se não cadastrado: sinaliza para novo cadastro.
 *   - Se cadastrado: ativa automaticamente a "Guarda Compartilhada" para o operador solicitante.
 * - POST /api/animals/[id]/collaborators: convida manualmente um colaborador para a guarda compartilhada.
 * - DELETE /api/animals/[id]/collaborators/[userId]: revoga o acesso de um colaborador (exclusivo do Dono Principal ou Admin).
 * - POST /api/animals/[id]/transfer-ownership: transfere a guarda definitiva / propriedade principal do animal.
 * - POST /api/animals: cadastra novo animal (o criador torna-se o Proprietário Principal).
 * - POST /api/animals/recalibrate: recalibra fotos do rebanho acessível.
 * - POST /api/animals/[id]/recalibrate: recalibra fotos de um animal específico.
 * - PATCH /api/animals/[id]: atualiza dados zootécnicos do animal.
 * - DELETE /api/animals/[id]: remove o animal e seus arquivos de imagem (exclusivo do Dono Principal ou Admin).
 * - CORS habilitado para integração transparente com mobile, web e hardware ESP32.
 */
import { prisma } from "@/lib/prisma";
import { isValidTag, normalizeTag } from "@/lib/animal";
import { readPhotoBuffer, deleteStoredFile } from "@/lib/storage";
import { analyzeRearImage } from "@/lib/ai";
import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/auth-guard";
import {
  canAccessAnimal,
  getAccessibleAnimalIds,
  addCollaborator,
  removeCollaborator,
  transferOwnership,
  getCustodyDetails,
} from "@/lib/custody";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const photoMetadataSelect = {
  id: true,
  animalId: true,
  view: true,
  score: true,
  createdAt: true,
} as const;

function formatAnimalWithIcs(animal: any) {
  if (!animal) return null;
  return {
    ...animal,
    ics: {
      status: "IN_DEVELOPMENT",
      score: null,
      scale: "1.0 - 5.0 (Padrão Zootécnico Bovino)",
      classification: "Em desenvolvimento",
      message: "Predição de ICS em fase de treinamento e validação neural.",
    },
    photos: (animal.photos || []).map((p: any) => ({
      ...p,
      ics: {
        status: "IN_DEVELOPMENT",
        score: null,
        classification: "Em desenvolvimento",
      },
    })),
  };
}

async function formatAnimalWithIcsAndCustody(
  animal: any,
  currentUserId: number,
  isAdmin: boolean
) {
  if (!animal) return null;
  const base = formatAnimalWithIcs(animal);
  const custody = await getCustodyDetails(animal.id, animal.ownerId, currentUserId, isAdmin);
  return {
    ...base,
    isOwner: animal.ownerId === currentUserId,
    isShared: animal.ownerId !== currentUserId,
    custody,
  };
}

type Context = { params: Promise<{ slug?: string[] }> };

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/* ── GET /api/animals OR /api/animals/[id] ── */
export async function GET(request: Request, context: Context) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user!;
  const userId = Number(user.id);
  const isAdmin = user.role === "ADMIN";

  const { slug = [] } = await context.params;

  // 1. GET /api/animals/[id]
  if (slug.length === 1 && slug[0] !== "recalibrate" && slug[0] !== "rfid-scan") {
    const animalId = slug[0];
    const animal = await prisma.animal.findUnique({
      where: { id: animalId },
      include: {
        photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
      },
    });

    if (!animal) {
      return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
    }

    const hasAccess = await canAccessAnimal(animal.id, animal.ownerId, userId, isAdmin);
    if (!hasAccess) {
      return corsJsonResponse(
        { error: "Você não possui permissão para visualizar este animal." },
        403,
        request
      );
    }

    const result = await formatAnimalWithIcsAndCustody(animal, userId, isAdmin);
    return corsJsonResponse(result, 200, request);
  }

  // 2. GET /api/animals (lista animais próprios + guarda compartilhada ou busca por tag)
  if (slug.length === 0) {
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get("tag");

    if (tag) {
      const normalized = normalizeTag(tag);
      const animal = await prisma.animal.findFirst({
        where: { tag: normalized },
        include: {
          photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
        },
      });

      if (!animal) {
        return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
      }

      const hasAccess = await canAccessAnimal(animal.id, animal.ownerId, userId, isAdmin);
      if (!hasAccess) {
        return corsJsonResponse(
          {
            error: "Animal já cadastrado no sistema por outro produtor. Conecte o leitor RFID para ingressar na guarda compartilhada.",
            requiresScan: true,
            tag: normalized,
          },
          403,
          request
        );
      }

      const result = await formatAnimalWithIcsAndCustody(animal, userId, isAdmin);
      return corsJsonResponse(result, 200, request);
    }

    // Busca IDs acessíveis (proprietário direto + colaboradores na tabela AnimalCollaborator)
    const { ownedIds, sharedIds } = await getAccessibleAnimalIds(userId, isAdmin);
    const allIds = Array.from(new Set([...ownedIds, ...sharedIds]));

    const animals = await prisma.animal.findMany({
      where: isAdmin ? {} : { id: { in: allIds } },
      include: {
        photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = animals.map((a: any) => {
      const base = formatAnimalWithIcs(a);
      return {
        ...base,
        isOwner: a.ownerId === userId,
        isShared: a.ownerId !== userId,
      };
    });

    return corsJsonResponse(formatted, 200, request);
  }

  return corsJsonResponse({ error: "Rota não encontrada" }, 404, request);
}

/* ── POST /api/animals OR /api/animals/rfid-scan OR subrotas de custódia e recalibração ── */
export async function POST(request: Request, context: Context) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user!;
  const userId = Number(user.id);
  const isAdmin = user.role === "ADMIN";

  const { slug = [] } = await context.params;

  // 1. POST /api/animals/rfid-scan (Lookup global por RFID com adesão instantânea à Guarda Compartilhada)
  if (slug.length === 1 && slug[0] === "rfid-scan") {
    try {
      const body = await request.json().catch(() => ({}));
      const rawRfid = normalizeTag(body.rfid ?? body.tag ?? "");

      if (!isValidTag(rawRfid)) {
        return corsJsonResponse({ error: "Código RFID inválido ou vazio." }, 400, request);
      }

      const animal = await prisma.animal.findFirst({
        where: { tag: rawRfid },
        include: {
          photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
        },
      });

      // Se a tag não existir no banco de dados, instrui o frontend a iniciar o novo cadastro
      if (!animal) {
        return corsJsonResponse(
          {
            registered: false,
            rfid: rawRfid,
            message: "Tag RFID não registrada. Prossiga com o cadastro do novo animal.",
          },
          200,
          request
        );
      }

      // Se o animal já existe e o operador atual não for o dono principal, ativa a Guarda Compartilhada
      let sharedGranted = false;
      if (animal.ownerId !== userId) {
        const collabResult = await addCollaborator(animal.id, userId);
        sharedGranted = collabResult.added;
      }

      const formatted = await formatAnimalWithIcsAndCustody(animal, userId, isAdmin);

      return corsJsonResponse(
        {
          registered: true,
          animal: formatted,
          sharedGranted,
          isOwner: animal.ownerId === userId,
          message:
            animal.ownerId === userId
              ? "Animal identificado com sucesso (Proprietário Principal)."
              : "Animal identificado! Guarda compartilhada ativada com sucesso.",
        },
        200,
        request
      );
    } catch (err: any) {
      console.error("[/api/animals/rfid-scan] Erro:", err);
      return corsJsonResponse({ error: "Falha ao processar leitura RFID." }, 500, request);
    }
  }

  // 2. POST /api/animals/[id]/collaborators (Convite manual de colaborador pelo dono/admin)
  if (slug.length === 2 && slug[1] === "collaborators") {
    const animalId = slug[0];
    const animal = await prisma.animal.findUnique({ where: { id: animalId } });

    if (!animal) {
      return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
    }

    if (animal.ownerId !== userId && !isAdmin) {
      return corsJsonResponse(
        { error: "Apenas o proprietário principal pode convidar colaboradores." },
        403,
        request
      );
    }

    const body = await request.json().catch(() => ({}));
    let targetUserId = body.userId ? Number(body.userId) : null;

    if (!targetUserId && body.email) {
      const targetUser = await prisma.user.findUnique({
        where: { email: String(body.email).toLowerCase().trim() },
        select: { id: true },
      });
      if (!targetUser) {
        return corsJsonResponse(
          { error: "Nenhum usuário com este e-mail foi encontrado." },
          404,
          request
        );
      }
      targetUserId = targetUser.id;
    }

    if (!targetUserId) {
      return corsJsonResponse(
        { error: "Informe o e-mail ou o ID do usuário colaborador." },
        400,
        request
      );
    }

    const result = await addCollaborator(animal.id, targetUserId);
    const custody = await getCustodyDetails(animal.id, animal.ownerId, userId, isAdmin);

    return corsJsonResponse({ ...result, custody }, 200, request);
  }

  // 3. POST /api/animals/[id]/transfer-ownership (Transferência definitiva de propriedade)
  if (slug.length === 2 && slug[1] === "transfer-ownership") {
    const animalId = slug[0];
    const body = await request.json().catch(() => ({}));
    const newOwnerId = Number(body.newOwnerId);

    if (!newOwnerId || Number.isNaN(newOwnerId)) {
      return corsJsonResponse({ error: "ID do novo proprietário inválido." }, 400, request);
    }

    const targetUser = await prisma.user.findUnique({ where: { id: newOwnerId } });
    if (!targetUser) {
      return corsJsonResponse({ error: "Novo proprietário não encontrado." }, 404, request);
    }

    const result = await transferOwnership(animalId, newOwnerId, userId, isAdmin);
    if (!result.success) {
      return corsJsonResponse({ error: result.message }, 400, request);
    }

    const custody = await getCustodyDetails(animalId, newOwnerId, userId, isAdmin);
    return corsJsonResponse({ ...result, custody }, 200, request);
  }

  // 4. POST /api/animals/recalibrate (recalibra fotos do rebanho acessível)
  if (slug.length === 1 && slug[0] === "recalibrate") {
    const { ownedIds, sharedIds } = await getAccessibleAnimalIds(userId, isAdmin);
    const accessibleIds = Array.from(new Set([...ownedIds, ...sharedIds]));

    const whereClause = isAdmin ? {} : { animalId: { in: accessibleIds } };

    const photos = await prisma.photo.findMany({
      where: whereClause,
      include: {
        animal: { select: { id: true, tag: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (photos.length === 0) {
      return corsJsonResponse(
        {
          success: true,
          message: "Nenhuma foto encontrada para recalibração.",
          updatedCount: 0,
          totalCount: 0,
        },
        200,
        request
      );
    }

    let updatedCount = 0;
    const affectedAnimalIds = new Set<string>();
    const results: Array<{ id: string; tag?: string; oldScore: number | null; newScore: number }> = [];

    for (const photo of photos) {
      try {
        const photoData = await readPhotoBuffer(photo.filePath);
        if (!photoData?.buffer) continue;

        const analysis = await analyzeRearImage(photoData.buffer);

        await prisma.photo.update({
          where: { id: photo.id },
          data: { score: analysis.score },
        });

        if (photo.animal?.id) {
          affectedAnimalIds.add(photo.animal.id);
        }

        updatedCount++;
        results.push({
          id: photo.id,
          tag: photo.animal?.tag,
          oldScore: photo.score,
          newScore: analysis.score,
        });
      } catch (err) {
        console.warn(`[recalibrate] Erro ao recalcular foto ${photo.id}:`, err);
      }
    }

    if (affectedAnimalIds.size > 0) {
      await prisma.animal
        .updateMany({
          where: { id: { in: Array.from(affectedAnimalIds) } },
          data: { updatedAt: new Date() },
        })
        .catch(() => {});
    }

    return corsJsonResponse(
      {
        success: true,
        updatedCount,
        totalCount: photos.length,
        message: `${updatedCount} de ${photos.length} fotos foram recalculadas com sucesso!`,
        results,
      },
      200,
      request
    );
  }

  // 5. POST /api/animals/[id]/recalibrate (recalibra fotos de um animal)
  if (slug.length === 2 && slug[1] === "recalibrate") {
    const animalId = slug[0];
    const animal = await prisma.animal.findUnique({
      where: { id: animalId },
      include: {
        photos: {
          select: { id: true, filePath: true, score: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!animal) {
      return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
    }

    const hasAccess = await canAccessAnimal(animal.id, animal.ownerId, userId, isAdmin);
    if (!hasAccess) {
      return corsJsonResponse(
        { error: "Você não tem permissão para recalcular as fotos deste animal" },
        403,
        request
      );
    }

    if (animal.photos.length === 0) {
      return corsJsonResponse(
        {
          success: true,
          message: "O animal não possui fotos para recalibrar.",
          updatedCount: 0,
          results: [],
        },
        200,
        request
      );
    }

    let updatedCount = 0;
    const results: Array<{ id: string; oldScore: number | null; newScore: number }> = [];

    for (const photo of animal.photos) {
      try {
        const photoData = await readPhotoBuffer(photo.filePath);
        if (!photoData?.buffer) continue;

        const analysis = await analyzeRearImage(photoData.buffer);

        await prisma.photo.update({
          where: { id: photo.id },
          data: { score: analysis.score },
        });

        updatedCount++;
        results.push({
          id: photo.id,
          oldScore: photo.score,
          newScore: analysis.score,
        });
      } catch (err) {
        console.warn(`[recalibrate/animal] Erro ao recalcular foto ${photo.id}:`, err);
      }
    }

    await prisma.animal
      .update({
        where: { id: animalId },
        data: { updatedAt: new Date() },
      })
      .catch(() => {});

    return corsJsonResponse(
      {
        success: true,
        updatedCount,
        totalCount: animal.photos.length,
        message: `${updatedCount} foto(s) do animal foram recalculadas com sucesso!`,
        results,
      },
      200,
      request
    );
  }

  // 6. POST /api/animals (criação de novo animal)
  if (slug.length === 0) {
    try {
      const body = await request.json().catch(() => ({}));
      const rawTag = normalizeTag(body.tag ?? "");
      const name = body.name ? String(body.name).trim() : "";
      const breed = String(body.breed ?? "Nelore").trim();
      const sex = String(body.sex ?? "Fêmea").trim();
      const weight = Number(body.weight);
      const age = Number(body.age);

      if (!isValidTag(rawTag)) {
        return corsJsonResponse(
          { error: "Identificador/Brinco/RFID inválido. Mínimo 2 caracteres." },
          400,
          request
        );
      }

      if (Number.isNaN(weight) || weight <= 0) {
        return corsJsonResponse({ error: "Peso deve ser um número positivo." }, 400, request);
      }

      if (Number.isNaN(age) || age < 0) {
        return corsJsonResponse({ error: "Idade deve ser zero ou positiva." }, 400, request);
      }

      // Verifica se o animal já está cadastrado no sistema
      const existing = await prisma.animal.findFirst({
        where: { tag: rawTag },
      });

      if (existing) {
        if (existing.ownerId === userId) {
          return corsJsonResponse(
            { error: "Você já possui um animal cadastrado com este brinco/RFID.", id: existing.id },
            409,
            request
          );
        } else {
          // Já existe sob posse de outro produtor: vincula automaticamente à guarda compartilhada
          await addCollaborator(existing.id, userId);
          return corsJsonResponse(
            {
              error: "Este animal já está cadastrado por outro produtor. Você foi adicionado à Guarda Compartilhada deste animal!",
              id: existing.id,
              sharedGranted: true,
            },
            409,
            request
          );
        }
      }

      const animal = await prisma.animal.create({
        data: {
          tag: rawTag,
          name,
          breed,
          sex,
          weight,
          age,
          ownerId: userId,
        },
      });

      return corsJsonResponse(animal, 201, request);
    } catch (err) {
      console.error("[/api/animals] Erro ao cadastrar:", err);
      return corsJsonResponse({ error: "Falha ao cadastrar o animal." }, 500, request);
    }
  }

  return corsJsonResponse({ error: "Subrota não encontrada" }, 404, request);
}

/* ── PATCH /api/animals/[id] ── */
export async function PATCH(request: Request, context: Context) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user!;
  const userId = Number(user.id);
  const isAdmin = user.role === "ADMIN";

  const { slug = [] } = await context.params;
  if (slug.length === 1 && slug[0] !== "recalibrate" && slug[0] !== "rfid-scan") {
    const animalId = slug[0];
    try {
      const animal = await prisma.animal.findUnique({ where: { id: animalId } });
      if (!animal) {
        return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
      }

      const hasAccess = await canAccessAnimal(animal.id, animal.ownerId, userId, isAdmin);
      if (!hasAccess) {
        return corsJsonResponse({ error: "Você não possui permissão para editar este animal." }, 403, request);
      }

      const body = await request.json().catch(() => ({}));
      const updateData: {
        tag?: string;
        name?: string;
        breed?: string;
        sex?: string;
        weight?: number;
        age?: number;
      } = {};

      if (body.tag !== undefined) {
        // Apenas o dono principal ou administrador pode alterar o identificador/RFID
        if (animal.ownerId !== userId && !isAdmin) {
          return corsJsonResponse(
            { error: "Apenas o proprietário principal pode alterar o brinco/RFID do animal." },
            403,
            request
          );
        }

        const rawTag = normalizeTag(body.tag);
        if (!isValidTag(rawTag)) {
          return corsJsonResponse({ error: "Brinco/RFID inválido." }, 400, request);
        }
        if (rawTag !== animal.tag) {
          const conflict = await prisma.animal.findFirst({
            where: { tag: rawTag, NOT: { id: animalId } },
          });
          if (conflict) {
            return corsJsonResponse(
              { error: "Já existe outro animal cadastrado com este identificador." },
              409,
              request
            );
          }
        }
        updateData.tag = rawTag;
      }

      if (body.name !== undefined) {
        updateData.name = body.name ? String(body.name).trim() : "";
      }
      if (body.breed !== undefined) {
        updateData.breed = String(body.breed).trim();
      }
      if (body.sex !== undefined) {
        updateData.sex = String(body.sex).trim();
      }
      if (body.weight !== undefined) {
        const w = Number(body.weight);
        if (Number.isNaN(w) || w <= 0) {
          return corsJsonResponse({ error: "Peso inválido." }, 400, request);
        }
        updateData.weight = w;
      }
      if (body.age !== undefined) {
        const a = Number(body.age);
        if (Number.isNaN(a) || a < 0) {
          return corsJsonResponse({ error: "Idade inválida." }, 400, request);
        }
        updateData.age = a;
      }

      const updated = await prisma.animal.update({
        where: { id: animalId },
        data: updateData,
        include: {
          photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
        },
      });

      const result = await formatAnimalWithIcsAndCustody(updated, userId, isAdmin);
      return corsJsonResponse(result, 200, request);
    } catch {
      return corsJsonResponse({ error: "Erro ao atualizar animal" }, 500, request);
    }
  }

  return corsJsonResponse({ error: "Subrota não encontrada" }, 404, request);
}

/* ── DELETE /api/animals/[id] OU /api/animals/[id]/collaborators/[targetUserId] ── */
export async function DELETE(request: Request, context: Context) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user!;
  const userId = Number(user.id);
  const isAdmin = user.role === "ADMIN";

  const { slug = [] } = await context.params;

  // 1. DELETE /api/animals/[id]/collaborators/[targetUserId] (Revogação de guarda compartilhada)
  if (slug.length === 3 && slug[1] === "collaborators") {
    const animalId = slug[0];
    const targetUserId = Number(slug[2]);

    if (!targetUserId || Number.isNaN(targetUserId)) {
      return corsJsonResponse({ error: "ID do colaborador inválido." }, 400, request);
    }

    const result = await removeCollaborator(animalId, targetUserId, userId, isAdmin);
    if (!result.success) {
      return corsJsonResponse({ error: result.message }, 400, request);
    }

    const custody = await getCustodyDetails(animalId, userId, userId, isAdmin);
    return corsJsonResponse({ ...result, custody }, 200, request);
  }

  // 2. DELETE /api/animals/[id] (Exclusão total do animal - apenas dono ou admin)
  if (slug.length === 1 && slug[0] !== "recalibrate" && slug[0] !== "rfid-scan") {
    const animalId = slug[0];
    try {
      const animal = await prisma.animal.findUnique({
        where: { id: animalId },
        include: { photos: { select: { id: true, filePath: true } } },
      });

      if (!animal) {
        return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
      }

      if (animal.ownerId !== userId && !isAdmin) {
        return corsJsonResponse(
          { error: "Apenas o proprietário principal pode excluir este animal do sistema." },
          403,
          request
        );
      }

      for (const photo of animal.photos) {
        try {
          await deleteStoredFile(photo.filePath);
        } catch {
          // segue mesmo se o arquivo físico já tiver sido removido
        }
      }

      await prisma.photo.deleteMany({ where: { animalId } });
      await prisma.animal.delete({ where: { id: animalId } });

      return corsJsonResponse({ ok: true, message: "Animal excluído com sucesso." }, 200, request);
    } catch {
      return corsJsonResponse({ error: "Erro ao excluir animal" }, 500, request);
    }
  }

  return corsJsonResponse({ error: "Subrota não encontrada" }, 404, request);
}
