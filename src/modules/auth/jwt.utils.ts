import jwt from "jsonwebtoken";
import type { Request } from "express";

/**
 * Utilitário de Tokens JWT (`src/modules/auth/jwt.utils.ts`).
 *
 * Emite e valida tokens JWT assinados com `AUTH_SECRET` (ou `JWT_SECRET`),
 * mantendo paridade com o formato `{ id, email, name, role }` consumido pelo frontend.
 */
export interface TokenPayload {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN" | string;
}

const EXPIRES_IN = "30d";

function getJwtSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET ||
    "cattle-vision-secret-key-2026-production"
  );
}

export function signJwtToken(payload: TokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: EXPIRES_IN });
}

export function verifyJwtToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as TokenPayload;
    if (decoded && decoded.id) {
      return {
        id: String(decoded.id),
        email: decoded.email,
        name: decoded.name,
        role: decoded.role || "USER",
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extrai usuário autenticado a partir de:
 * 1. Header `Authorization: Bearer <token>`
 * 2. Cookie `auth_token=<token>`
 */
export function extractAuthUserFromRequest(req: Request): TokenPayload | null {
  const rawAuth = req.headers.authorization || (req.headers as Record<string, string | undefined>).Authorization;
  if (typeof rawAuth === "string" && rawAuth.startsWith("Bearer ")) {
    const token = rawAuth.substring(7).trim();
    const user = verifyJwtToken(token);
    if (user) return user;
  }

  const cookieHeader = typeof req.headers.cookie === "string" ? req.headers.cookie : "";
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  if (match && match[1]) {
    return verifyJwtToken(decodeURIComponent(match[1]));
  }

  return null;
}
