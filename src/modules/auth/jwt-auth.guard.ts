import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { extractAuthUserFromRequest, TokenPayload } from "./jwt.utils";

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Guard obrigatório de autenticação JWT Bearer / Cookie (`src/modules/auth/jwt-auth.guard.ts`).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = extractAuthUserFromRequest(req);
    if (!user) {
      throw new UnauthorizedException("Não autenticado. Forneça um token Bearer válido.");
    }
    req.user = user;
    return true;
  }
}

/**
 * Guard opcional usado em rotas híbridas (ex.: `GET /api/photos/:id`) que validam acesso
 * quando há token e permitem entrega proxy pública quando o browser requisita `<img>` sem header.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = extractAuthUserFromRequest(req);
    if (user) {
      req.user = user;
    }
    return true;
  }
}
