import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { signJwtToken } from "@/lib/jwt";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;

  const user = auth.user;
  if (!user) {
    return corsJsonResponse({ error: "Não autorizado" }, 401, request);
  }

  // Tenta sincronizar dados mais atualizados do banco
  const dbUser = await prisma.user
    .findUnique({
      where: { id: Number(user.id) },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    })
    .catch(() => null);

  return corsJsonResponse(
    {
      user: dbUser
        ? {
            id: String(dbUser.id),
            name: dbUser.name,
            email: dbUser.email,
            role: dbUser.role,
            createdAt: dbUser.createdAt,
          }
        : user,
    },
    200,
    request
  );
}

/**
 * Atualiza perfil do usuário autenticado (nome de exibição e/ou troca de senha).
 * Em caso de sucesso, também emite um novo JWT para manter nome atualizado no token stateless.
 */
export async function PATCH(request: Request) {
  const auth = requireAuth(request);
  if (auth.error) return auth.error;

  const user = auth.user;
  if (!user) {
    return corsJsonResponse({ error: "Não autorizado" }, 401, request);
  }

  try {
    const body = await request.json();
    const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
    const currentPassword =
      typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword =
      typeof body.newPassword === "string" ? body.newPassword : "";

    if (nextName !== undefined && nextName.length < 2) {
      return corsJsonResponse(
        { error: "Nome deve ter pelo menos 2 caracteres." },
        400,
        request
      );
    }

    if (newPassword && newPassword.length < 6) {
      return corsJsonResponse(
        { error: "Nova senha deve ter pelo menos 6 caracteres." },
        400,
        request
      );
    }

    const userId = Number(user.id);
    if (!Number.isFinite(userId)) {
      return corsJsonResponse({ error: "Usuário inválido." }, 400, request);
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!dbUser) {
      return corsJsonResponse({ error: "Usuário não encontrado." }, 404, request);
    }

    const dataToUpdate: { name?: string; password?: string } = {};

    if (nextName !== undefined && nextName !== dbUser.name) {
      dataToUpdate.name = nextName;
    }

    if (newPassword) {
      if (!currentPassword) {
        return corsJsonResponse(
          { error: "Informe a senha atual para definir uma nova senha." },
          400,
          request
        );
      }

      const validCurrent = await bcrypt.compare(currentPassword, dbUser.password);
      if (!validCurrent) {
        return corsJsonResponse(
          { error: "Senha atual incorreta." },
          400,
          request
        );
      }

      dataToUpdate.password = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser =
      Object.keys(dataToUpdate).length > 0
        ? await prisma.user.update({
            where: { id: userId },
            data: dataToUpdate,
            select: { id: true, name: true, email: true, role: true, createdAt: true },
          })
        : {
            id: dbUser.id,
            name: dbUser.name,
            email: dbUser.email,
            role: dbUser.role,
            createdAt: dbUser.createdAt,
          };

    const userPayload = {
      id: String(updatedUser.id),
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      createdAt: updatedUser.createdAt,
    };

    const token = signJwtToken({
      id: userPayload.id,
      name: userPayload.name,
      email: userPayload.email,
      role: userPayload.role,
    });

    return corsJsonResponse(
      {
        message: "Perfil atualizado com sucesso.",
        user: userPayload,
        token,
      },
      200,
      request
    );
  } catch (error) {
    console.error("Erro ao atualizar perfil:", error);
    return corsJsonResponse({ error: "Erro ao atualizar perfil." }, 500, request);
  }
}
