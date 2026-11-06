/**
 * API Administrativa Unificada (`src/app/api/admin/[[...slug]]/route.ts`).
 *
 * Funcionalidades:
 * - GET /api/admin/animals: lista global de todos os animais e fotos de todos os usuários.
 * - GET /api/admin/users: lista de operadores e administradores com contagem de animais/fotos.
 * - GET /api/admin/export: download do dataset zootécnico consolidado em ZIP (imagens + CSV + JSON).
 * - POST /api/admin/recalibrate: recalcula a confiança de todas as fotos do banco com YOLO ONNX.
 * - POST /api/admin/users: cadastra novo usuário/administrador ou promove existente.
 * - PATCH /api/admin/users/[id]: alterna papéis (USER <-> ADMIN).
 * - DELETE /api/admin/users/[id]: remove um usuário do sistema.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readPhotoBuffer } from "@/lib/storage";
import { analyzeRearImage } from "@/lib/ai";
import bcrypt from "bcryptjs";
import { handleCorsPreflight, corsJsonResponse, getCorsHeaders } from "@/lib/cors";
import { requireAdmin } from "@/lib/auth-guard";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug?: string[] }> };

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

/* ── GET /api/admin/... ── */
export async function GET(req: Request, context: Context) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;
  const user = auth.user!;

  const { slug = [] } = await context.params;
  const subRoute = slug[0];

  // 1. GET /api/admin/animals
  if (subRoute === "animals") {
    const animals = await prisma.animal.findMany({
      include: {
        photos: {
          select: {
            id: true,
            animalId: true,
            view: true,
            score: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
        owner: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return corsJsonResponse(animals, 200, req);
  }

  // 2. GET /api/admin/users
  if (subRoute === "users") {
    const callerId = Number(user.id);
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        animals: {
          select: {
            id: true,
            _count: {
              select: { photos: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const formattedUsers = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      animalsCount: u.animals.length,
      photosCount: u.animals.reduce((acc, a) => acc + a._count.photos, 0),
      isSelf: u.id === callerId,
    }));

    return corsJsonResponse(formattedUsers, 200, req);
  }

  // 3. GET /api/admin/export (gera ZIP com fotos, manifest.json e dataset.csv)
  if (subRoute === "export") {
    try {
      const AdmZip = (await import("adm-zip")).default;
      const animals = await prisma.animal.findMany({
        include: {
          photos: { orderBy: { createdAt: "desc" } },
          owner: { select: { name: true, email: true } },
        },
        orderBy: { updatedAt: "desc" },
      });

      const zip = new AdmZip();
      const manifest: Array<Record<string, unknown>> = [];
      const csvRows: string[] = [
        [
          "file",
          "photo_id",
          "animal_id",
          "tag",
          "name",
          "breed",
          "sex",
          "weight_kg",
          "age_months",
          "view",
          "ai_score",
          "created_at",
          "owner_name",
          "owner_email",
        ].join(","),
      ];

      for (const animal of animals) {
        for (const photo of animal.photos) {
          const fileName = `${animal.tag}_${photo.id}.jpg`;
          const filePath = `images/${fileName}`;

          try {
            const photoData = await readPhotoBuffer(photo.filePath);
            if (photoData?.buffer) {
              zip.addFile(filePath, photoData.buffer);
            }
          } catch (err) {
            console.error("[/api/admin/export] Erro ao ler foto:", photo.id, err);
          }

          manifest.push({
            file: filePath,
            photoId: photo.id,
            animalId: animal.id,
            tag: animal.tag,
            name: animal.name,
            breed: animal.breed,
            sex: animal.sex,
            weight: animal.weight,
            age: animal.age,
            view: photo.view,
            aiScore: photo.score,
            createdAt: photo.createdAt.toISOString(),
            owner: {
              name: animal.owner.name,
              email: animal.owner.email,
            },
          });

          const escapeCsv = (val: unknown) => {
            const str = String(val ?? "");
            return str.includes(",") || str.includes('"') || str.includes("\n")
              ? `"${str.replace(/"/g, '""')}"`
              : str;
          };

          csvRows.push(
            [
              escapeCsv(filePath),
              escapeCsv(photo.id),
              escapeCsv(animal.id),
              escapeCsv(animal.tag),
              escapeCsv(animal.name),
              escapeCsv(animal.breed),
              escapeCsv(animal.sex),
              escapeCsv(animal.weight),
              escapeCsv(animal.age),
              escapeCsv(photo.view),
              escapeCsv(photo.score ?? ""),
              escapeCsv(photo.createdAt.toISOString()),
              escapeCsv(animal.owner.name),
              escapeCsv(animal.owner.email),
            ].join(",")
          );
        }
      }

      zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"));
      zip.addFile("dataset.csv", Buffer.from(csvRows.join("\n"), "utf-8"));

      const zipBuffer = zip.toBuffer();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const downloadFilename = `cattle-ics-dataset-${timestamp}.zip`;
      const corsHeaders = getCorsHeaders(req);

      return new NextResponse(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${downloadFilename}"`,
          "Content-Length": String(zipBuffer.length),
        },
      });
    } catch (err) {
      console.error("[/api/admin/export] Erro ao gerar ZIP:", err);
      return corsJsonResponse({ error: "Falha ao gerar dataset ZIP" }, 500, req);
    }
  }

  // 4. GET /api/admin (verificação de status admin)
  if (slug.length === 0) {
    return corsJsonResponse({ ok: true, admin: true }, 200, req);
  }

  return corsJsonResponse({ error: "Subrota administrativa não encontrada" }, 404, req);
}

/* ── POST /api/admin/... ── */
export async function POST(req: Request, context: Context) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;
  const user = auth.user!;

  const { slug = [] } = await context.params;
  const subRoute = slug[0];

  // 1. POST /api/admin/recalibrate (recalcula todos os scores do banco)
  if (subRoute === "recalibrate") {
    const photos = await prisma.photo.findMany({
      select: {
        id: true,
        filePath: true,
        score: true,
        animalId: true,
        animal: { select: { tag: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    let updatedCount = 0;
    const affectedAnimalIds = new Set<string>();
    const results: Array<{ id: string; tag?: string; oldScore: number | null; newScore: number }> = [];

    for (const photo of photos) {
      try {
        const photoData = await readPhotoBuffer(photo.filePath);
        if (!photoData?.buffer) {
          console.warn(`[admin/recalibrate] Buffer indisponível para foto ${photo.id}`);
          continue;
        }

        const analysis = await analyzeRearImage(photoData.buffer);

        await prisma.photo.update({
          where: { id: photo.id },
          data: { score: analysis.score },
        });

        if (photo.animalId) {
          affectedAnimalIds.add(photo.animalId);
        }

        updatedCount++;
        results.push({
          id: photo.id,
          tag: photo.animal?.tag,
          oldScore: photo.score,
          newScore: analysis.score,
        });
      } catch (err) {
        console.warn(`[admin/recalibrate] Erro ao recalcular foto ${photo.id}:`, err);
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
      req
    );
  }

  // 2. POST /api/admin/users (criar ou promover usuário)
  if (subRoute === "users") {
    const callerId = Number(user.id);
    const body = await req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const targetRole = body.role === "ADMIN" ? "ADMIN" : "USER";

    if (!name || !email) {
      return corsJsonResponse({ error: "Nome e e-mail são obrigatórios" }, 400, req);
    }

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      const updateData: { name: string; role: string; password?: string } = {
        name: name || existing.name,
        role: targetRole,
      };
      if (password && password.length >= 6) {
        updateData.password = await bcrypt.hash(password, 10);
      }

      const updated = await prisma.user.update({
        where: { id: existing.id },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      return corsJsonResponse(
        {
          ...updated,
          animalsCount: 0,
          photosCount: 0,
          isSelf: updated.id === callerId,
          updatedExisting: true,
        },
        200,
        req
      );
    }

    if (!password || password.length < 6) {
      return corsJsonResponse(
        { error: "Para novos usuários, a senha deve ter pelo menos 6 caracteres" },
        400,
        req
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const created = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: targetRole,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return corsJsonResponse(
      {
        ...created,
        animalsCount: 0,
        photosCount: 0,
        isSelf: created.id === callerId,
      },
      201,
      req
    );
  }

  return corsJsonResponse({ error: "Subrota não encontrada" }, 404, req);
}

/* ── PATCH /api/admin/users/[id] ── */
export async function PATCH(req: Request, context: Context) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;
  const user = auth.user!;

  const { slug = [] } = await context.params;
  if (slug[0] === "users" && slug[1]) {
    const userId = Number(slug[1]);
    const callerId = Number(user.id);

    if (!Number.isFinite(userId)) {
      return corsJsonResponse({ error: "ID de usuário inválido" }, 400, req);
    }

    const body = await req.json().catch(() => ({}));
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return corsJsonResponse({ error: "Usuário não encontrado" }, 404, req);
    }

    if (userId === callerId && body.role && body.role !== "ADMIN") {
      return corsJsonResponse(
        { error: "Você não pode remover seu próprio privilégio de administrador." },
        400,
        req
      );
    }

    const updateData: { role?: string; name?: string; password?: string } = {};
    if (body.role === "ADMIN" || body.role === "USER") {
      updateData.role = body.role;
    }
    if (typeof body.name === "string" && body.name.trim()) {
      updateData.name = body.name.trim();
    }
    if (typeof body.password === "string" && body.password.length >= 6) {
      updateData.password = await bcrypt.hash(body.password, 10);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return corsJsonResponse(updated, 200, req);
  }

  return corsJsonResponse({ error: "Operação PATCH não suportada neste endpoint" }, 404, req);
}

/* ── DELETE /api/admin/users/[id] ── */
export async function DELETE(req: Request, context: Context) {
  const auth = requireAdmin(req);
  if (auth.error) return auth.error;
  const user = auth.user!;

  const { slug = [] } = await context.params;
  if (slug[0] === "users" && slug[1]) {
    const userId = Number(slug[1]);
    const callerId = Number(user.id);

    if (!Number.isFinite(userId)) {
      return corsJsonResponse({ error: "ID de usuário inválido" }, 400, req);
    }

    if (userId === callerId) {
      return corsJsonResponse(
        { error: "Você não pode excluir sua própria conta de administrador." },
        400,
        req
      );
    }

    await prisma.user.delete({ where: { id: userId } });
    return corsJsonResponse({ message: "Usuário removido com sucesso" }, 200, req);
  }

  return corsJsonResponse({ error: "Operação DELETE não suportada neste endpoint" }, 404, req);
}
