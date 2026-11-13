import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest } from "./jwt-auth.guard";
import type { TokenPayload } from "./jwt.utils";

/**
 * Param decorator `@CurrentUser()` para injetar o `TokenPayload` validado nos controllers.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TokenPayload | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  }
);
