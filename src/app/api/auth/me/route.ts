import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";

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
