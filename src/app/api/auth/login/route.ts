import { handleCorsPreflight, corsJsonResponse } from "@/lib/cors";
import { prisma } from "@/lib/prisma";
import { signJwtToken } from "@/lib/jwt";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return handleCorsPreflight(request);
}

function getEnvAdminConfig() {
  const email = (
    process.env.ADMIN_EMAIL ||
    process.env.ADMIN_USER ||
    "admin@cattlecapture.com"
  )
    .trim()
    .toLowerCase();
  const password = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || "admin123";
  const name = (process.env.ADMIN_NAME || "Administrador CattleVision").trim();
  return { email, password, name };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawEmail = String(body.email ?? "")
      .trim()
      .toLowerCase();
    const rawPassword = String(body.password ?? "");

    if (!rawEmail || !rawPassword) {
      return corsJsonResponse({ error: "E-mail e senha são obrigatórios." }, 400, request);
    }

    const envAdmin = getEnvAdminConfig();

    const isEnvAdminIdentifier =
      rawEmail === envAdmin.email ||
      rawEmail === "admin" ||
      rawEmail === "admin@cattlecapture.com";

    const isEnvAdminPassword =
      rawPassword === envAdmin.password ||
      (!process.env.ADMIN_PASSWORD && (rawPassword === "admin123" || rawPassword === "admin"));

    if (isEnvAdminIdentifier && isEnvAdminPassword) {
      let adminId = "1";
      try {
        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        const adminUser = await prisma.user.upsert({
          where: { email: envAdmin.email },
          update: {
            role: "ADMIN",
            name: envAdmin.name,
          },
          create: {
            email: envAdmin.email,
            name: envAdmin.name,
            password: hashedPassword,
            role: "ADMIN",
          },
        });
        adminId = String(adminUser.id);
      } catch (dbErr) {
        console.warn("[auth/login] Aviso ao sincronizar Admin no banco:", dbErr);
      }

      const userPayload = {
        id: adminId,
        email: envAdmin.email,
        name: envAdmin.name,
        role: "ADMIN",
      };

      const token = signJwtToken(userPayload);
      return corsJsonResponse({ token, user: userPayload }, 200, request);
    }

    // Fluxo normal de autenticação no PostgreSQL
    const emailToLookup = rawEmail === "admin" ? envAdmin.email : rawEmail;
    const user = await prisma.user.findUnique({ where: { email: emailToLookup } });
    if (!user) {
      return corsJsonResponse({ error: "E-mail ou senha incorretos." }, 401, request);
    }

    const passwordMatches = await bcrypt.compare(rawPassword, user.password);
    if (!passwordMatches) {
      return corsJsonResponse({ error: "E-mail ou senha incorretos." }, 401, request);
    }

    const resolvedRole =
      user.email.toLowerCase() === envAdmin.email ? "ADMIN" : user.role;

    const userPayload = {
      id: String(user.id),
      email: user.email,
      name: user.name,
      role: resolvedRole,
    };

    const token = signJwtToken(userPayload);
    return corsJsonResponse({ token, user: userPayload }, 200, request);
  } catch (error) {
    console.error("[auth/login] Erro interno:", error);
    return corsJsonResponse({ error: "Erro interno no servidor de autenticação." }, 500, request);
  }
}
