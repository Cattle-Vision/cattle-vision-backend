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

# Multi-stage Runner
FROM node:22-slim AS runner

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app ./

ENV NODE_ENV=production
ENV PORT=3001
ENV CORS_ORIGIN="*"

EXPOSE 3001

CMD ["sh", "-c", "npx prisma db push --skip-generate --accept-data-loss && npm run start"]
