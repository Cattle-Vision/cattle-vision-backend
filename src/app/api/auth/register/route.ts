import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";
import { prisma } from "@/lib/prisma";
import { signJwtToken } from "@/lib/jwt";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

function getEnvAdminEmail(): string {
  return (
    process.env.ADMIN_EMAIL ||
    process.env.ADMIN_USER ||
    "admin@cattlecapture.com"
  )
    .trim()
    .toLowerCase();
}

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json().catch(() => ({}));
    const trimmedName = String(name ?? "").trim();
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    const pwd = String(password ?? "");

    if (!trimmedName || !normalizedEmail || !pwd) {
      return corsJsonResponse({ error: "Preencha todos os campos." }, 400, request);
    }
    if (pwd.length < 6) {
      return corsJsonResponse(
        { error: "A senha precisa ter pelo menos 6 caracteres." },
        400,
        request
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return corsJsonResponse({ error: "Este e-mail já está cadastrado." }, 400, request);
    }

    const role = normalizedEmail === getEnvAdminEmail() ? "ADMIN" : "USER";
    const hashedPassword = await bcrypt.hash(pwd, 10);

    const user = await prisma.user.create({
      data: {
        name: trimmedName,
        email: normalizedEmail,
        password: hashedPassword,
        role,
      },
    });

    const userPayload = {
      id: String(user.id),
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const token = signJwtToken(userPayload);

    return corsJsonResponse(
      {
        token,
        user: userPayload,
        message: "Conta criada com sucesso!",
      },
      201,
      request
    );
  } catch (err) {
    console.error("[/api/auth/register] Erro:", err);
    return corsJsonResponse({ error: "Erro interno ao criar conta." }, 500, request);
  }
}
