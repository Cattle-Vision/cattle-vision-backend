import jwt from "jsonwebtoken";

/**
 * Utilitário de Tokens JWT para Autenticação Desacoplada (`src/lib/jwt.ts`).
 *
 * Responsabilidade:
 * - Emitir tokens JWT assinados com `AUTH_SECRET` (ou `JWT_SECRET`).
 * - Validar tokens recebidos no header `Authorization: Bearer <token>` de clientes
 *   rodando em diferentes PCs, origens ou servidores.
 */

export interface TokenPayload {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN" | string;
}

const SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || "cattle-vision-secret-key-2026-production";
const EXPIRES_IN = "30d";

export function signJwtToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyJwtToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as TokenPayload;
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
 * Extrai e valida o token JWT a partir dos headers da requisição HTTP.
 * Aceita:
 * 1. Header `Authorization: Bearer <token>`
 * 2. Cookie `auth_token=<token>`
 */
export function extractAuthUser(request: Request): TokenPayload | null {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    const user = verifyJwtToken(token);
    if (user) return user;
  }

  // Fallback para Cookie em clientes web diretos
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)auth_token=([^;]+)/);
  if (match && match[1]) {
    const token = decodeURIComponent(match[1]);
    return verifyJwtToken(token);
  }

  return null;
}
