# ============================================================================
# CattleVision Backend — Dockerfile Multi-Stage de Produção
# ============================================================================
FROM node:22-slim AS builder

RUN apt-get update -y && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts --network-timeout=1000000 || npm install --ignore-scripts --network-timeout=1000000

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN npm run build

# Multi-stage Runner
FROM node:22-slim AS runner

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app ./

RUN mkdir -p /app/storage/uploads /app/backups

ENV NODE_ENV=production
ENV PORT=3001
ENV CORS_ORIGIN="*"

EXPOSE 3001

# Executa backup preventivo (se já houver tabelas) e prisma migrate deploy (nunca db push destrutivo)
CMD ["node", "scripts/safe-start.js"]
