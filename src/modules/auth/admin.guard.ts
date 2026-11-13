import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { AuthenticatedRequest } from "./jwt-auth.guard";

/**
 * Guard RBAC para rotas restritas a administradores (`src/modules/auth/admin.guard.ts`).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.user?.role !== "ADMIN") {
      throw new ForbiddenException("Acesso restrito a administradores.");
    }
    return true;
  }
}
