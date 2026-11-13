import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { bootstrapEnv } from "../config/env";

bootstrapEnv();

/**
 * Serviço Global Prisma (`src/prisma/prisma.service.ts`).
 *
 * Gerencia o ciclo de vida da conexão PostgreSQL dentro do container de DI do NestJS,
 * garantindo resolução compatível de URLs Vercel/Neon/Docker antes do `$connect`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
  }

  async onModuleInit(): Promise<void> {
    // Em ambiente Serverless (Vercel), a conexao abre sob demanda na primeira query para
    // evitar bloqueio de handshake TLS em rotas leves como /api/health e cold starts.
    if (process.env.VERCEL !== "1") {
      await this.$connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
