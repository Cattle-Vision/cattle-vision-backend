/**
 * API de Gestão de Animais (`src/app/api/animals/[[...slug]]/route.ts`).
 *
 * Funcionalidades:
 * - GET /api/animals: lista animais do usuário autenticado ou busca por ?tag=...
 * - GET /api/animals/[id]: retorna detalhes completos do animal e suas fotos.
 * - POST /api/animals: cadastra novo animal.
 * - POST /api/animals/recalibrate: recalibra fotos do rebanho.
 * - POST /api/animals/[id]/recalibrate: recalibra fotos de um animal específico.
 * - PATCH /api/animals/[id]: atualiza dados zootécnicos do animal.
 * - DELETE /api/animals/[id]: remove o animal e seus arquivos de imagem.
 * - CORS habilitado para chamadas cross-origin de qualquer PC/servidor.
 */
import { prisma } from "@/lib/prisma";
import { isValidTag, normalizeTag } from "@/lib/animal";
import { readPhotoBuffer, deleteStoredFile } from "@/lib/storage";
import { analyzeRearImage } from "@/lib/ai";
import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/auth-guard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const photoMetadataSelect = {
  id: true,
  animalId: true,
  view: true,
  score: true,
  createdAt: true,
} as const;

function canAccess(ownerId: number, user: { id: string; role: string }) {
  return ownerId === Number(user.id) || user.role === "ADMIN";
}

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

type Context = { params: Promise<{ slug?: string[] }> };

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/* ── GET /api/animals OR /api/animals/[id] ── */
export async function GET(request: Request, context: Context) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user!;

  const { slug = [] } = await context.params;

  // 1. GET /api/animals/[id]
  if (slug.length === 1 && slug[0] !== "recalibrate") {
    const animalId = slug[0];
    const animal = await prisma.animal.findUnique({
      where: { id: animalId },
      include: {
        photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
      },
    });

    if (!animal || !canAccess(animal.ownerId, user)) {
      return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
    }

    return corsJsonResponse(formatAnimalWithIcs(animal), 200, request);
  }

  // 2. GET /api/animals (lista todos do usuário ou busca por tag)
  if (slug.length === 0) {
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get("tag");

    const userId = Number(user.id);
    const isAdmin = user.role === "ADMIN";

    if (tag) {
      const normalized = normalizeTag(tag);
      const animal = await prisma.animal.findFirst({
        where: isAdmin
          ? { tag: normalized }
          : { tag: normalized, ownerId: userId },
        include: {
          photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
        },
      });

      if (!animal) {
        return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
      }

      return corsJsonResponse(formatAnimalWithIcs(animal), 200, request);
    }

    const animals = await prisma.animal.findMany({
      where: { ownerId: userId },
      include: {
        photos: { select: photoMetadataSelect, orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return corsJsonResponse(animals.map(formatAnimalWithIcs), 200, request);
  }

  return corsJsonResponse({ error: "Rota não encontrada" }, 404, request);
}

/* ── POST /api/animals OR /api/animals/recalibrate OR /api/animals/[id]/recalibrate ── */
export async function POST(request: Request, context: Context) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user!;

  const { slug = [] } = await context.params;

  // 1. POST /api/animals/recalibrate (recalibra fotos do rebanho)
  if (slug.length === 1 && slug[0] === "recalibrate") {
    const isAdmin = user.role === "ADMIN";
    const userId = Number(user.id);
    const whereClause = isAdmin ? {} : { animal: { ownerId: userId } };

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

  // 2. POST /api/animals/[id]/recalibrate (recalibra fotos de um animal)
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

    if (!canAccess(animal.ownerId, user)) {
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

  // 3. POST /api/animals (criação de novo animal)
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
          { error: "Identificador/Brinco inválido. Mínimo 2 caracteres." },
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

      const userId = Number(user.id);

      const existing = await prisma.animal.findFirst({
        where: { tag: rawTag, ownerId: userId },
      });

      if (existing) {
        return corsJsonResponse(
          { error: "Você já possui um animal cadastrado com este brinco.", id: existing.id },
          409,
          request
        );
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

  const { slug = [] } = await context.params;
  if (slug.length === 1 && slug[0] !== "recalibrate") {
    const animalId = slug[0];
    try {
      const animal = await prisma.animal.findUnique({ where: { id: animalId } });
      if (!animal || !canAccess(animal.ownerId, user)) {
        return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
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
        const rawTag = normalizeTag(body.tag);
        if (!isValidTag(rawTag)) {
          return corsJsonResponse({ error: "Brinco inválido." }, 400, request);
        }
        if (rawTag !== animal.tag) {
          const conflict = await prisma.animal.findFirst({
            where: { tag: rawTag, ownerId: animal.ownerId, NOT: { id: animalId } },
          });
          if (conflict) {
            return corsJsonResponse(
              { error: "Já existe outro animal com este brinco." },
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

      return corsJsonResponse(updated, 200, request);
    } catch {
      return corsJsonResponse({ error: "Erro ao atualizar animal" }, 500, request);
    }
  }

  return corsJsonResponse({ error: "Subrota não encontrada" }, 404, request);
}

/* ── DELETE /api/animals/[id] ── */
export async function DELETE(request: Request, context: Context) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;
  const user = auth.user!;

  const { slug = [] } = await context.params;
  if (slug.length === 1 && slug[0] !== "recalibrate") {
    const animalId = slug[0];
    try {
      const animal = await prisma.animal.findUnique({
        where: { id: animalId },
        include: { photos: { select: { id: true, filePath: true } } },
      });

      if (!animal || !canAccess(animal.ownerId, user)) {
        return corsJsonResponse({ error: "Animal não encontrado" }, 404, request);
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
