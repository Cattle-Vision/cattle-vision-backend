import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";

/**
 * Filtro Global de Exceções HTTP (`src/common/filters/api-exception.filter.ts`).
 *
 * Padroniza respostas de erro no formato `{ error: string, ...extras }` esperado pelo
 * cliente HTTP do `cattle-vision-frontend`, preservando metadados extras (como `id`,
 * `sharedGranted` ou `requiresScan` em respostas 403/409).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const rawResponse = exception.getResponse();

      if (typeof rawResponse === "string") {
        res.status(status).json({ error: rawResponse });
        return;
      }

      if (rawResponse && typeof rawResponse === "object") {
        const obj = rawResponse as Record<string, unknown>;
        const message = Array.isArray(obj.message)
          ? obj.message.join("; ")
          : typeof obj.error === "string" && obj.error !== "Bad Request" && obj.error !== "Forbidden" && obj.error !== "Unauthorized" && obj.error !== "Conflict" && obj.error !== "Not Found"
          ? obj.error
          : typeof obj.message === "string"
          ? obj.message
          : typeof obj.error === "string"
          ? obj.error
          : "Erro na requisição.";

        const { message: _m, statusCode: _s, ...rest } = obj;
        res.status(status).json({
          ...rest,
          error: message,
        });
        return;
      }
    }

    const fallbackMsg =
      exception instanceof Error ? exception.message : "Erro interno no servidor.";
    console.error("[ApiExceptionFilter] Erro não tratado:", exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: fallbackMsg,
    });
  }
}
