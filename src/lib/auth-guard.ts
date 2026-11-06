import { NextResponse } from "next/server";
import { extractAuthUser, TokenPayload } from "@/lib/jwt";
import { corsJsonResponse } from "@/lib/cors";

/**
 * Middleware / Guard de Autenticação para APIs do Backend (`src/lib/auth-guard.ts`).
 *
 * Responsabilidade:
 * - Validar se o cliente enviou um token JWT Bearer válido.
 * - Garantir RBAC (Role-Based Access Control) para rotas restritas a administradores.
 * - Retornar imediatamente `401 Não Autorizado` ou `403 Acesso Negado` com headers CORS.
 */

export interface AuthContextResult {
  user: TokenPayload | null;
  error?: NextResponse;
}

export function requireAuth(request: Request): AuthContextResult {
  const user = extractAuthUser(request);
  if (!user) {
    return {
      user: null,
      error: corsJsonResponse({ error: "Não autenticado. Forneça um token Bearer válido." }, 401, request),
    };
  }
  return { user };
}

export function requireAdmin(request: Request): AuthContextResult {
  const auth = requireAuth(request);
  if (auth.error) return auth;

  if (auth.user?.role !== "ADMIN") {
    return {
      user: null,
      error: corsJsonResponse({ error: "Acesso restrito a administradores." }, 403, request),
    };
  }

  return auth;
}
