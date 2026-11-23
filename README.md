# CattleVision Backend (`NestJS`)

Serviço de API RESTful em **NestJS 10**, Inferência de Visão Computacional (**ONNX Runtime Node**) e Gerenciamento Zootécnico / ICS Bovino.

---

## Recursos Arquiteturais
- **NestJS Modular (`src/modules/*`) + Serverless Express (`api/index.ts`)**: Executa tanto em servidor Node/Docker (`src/main.ts`) quanto em Serverless Function na Vercel (`gru1`, `framework: null`).
- **Visão Computacional ONNX no Backend**:
  - `identifier.onnx` (512×512 Letterbox) + guardas semânticos (`version-RFB-320.onnx` e `yolo11n.onnx`) para validação anatômica, recalibragem e fallback.
  - Inferência de **ICS / Escore Corporal Bovino** executada exclusivamente no servidor.
- **Suporte Multi-Origem e CORS Dinâmico**: Compatível com frontend na Vercel, rede local Wi-Fi rural ou Docker.
- **Autenticação Stateless JWT**: Comunicação desacoplada via header `Authorization: Bearer <token>`.
- **Armazenamento Híbrido Resiliente**: Vercel Blob Storage (privado/público) com fallback automático para Base64 inline no PostgreSQL ou armazenamento local em disco.
- **Prisma ORM com Proteção Anti-Drift**: Migrações versionadas em `prisma/migrations` e scripts seguros (`safe-start.js`, `db-backup.js`, `check-migrations.js`).

---

## Configuração Rápida

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure o arquivo `.env.local` ou `.env` (baseado em `.env.example`):
   ```bash
   cp .env.example .env.local
   ```

3. Gere o Prisma Client e aplique as migrações versionadas:
   ```bash
   npx prisma generate
   npm run db:migrate
   ```

4. Inicie o servidor:
   ```bash
   npm run dev
   ```
   A API estará acessível em `http://localhost:3001` (healthcheck: `http://localhost:3001/api/health`).

---

## Deploy na Vercel
1. Conecte o repositório `cattle-vision-backend` na Vercel (região `gru1` configurada em `vercel.json`).
2. Configure as variáveis de ambiente em **Project Settings > Environment Variables**:
   - `CORS_ORIGIN`: URL do seu frontend (ex: `https://cattle-vision-frontend.vercel.app` ou `*`).
   - `AUTH_SECRET`: Segredo JWT de produção.
   - `DATA_POSTGRES_PRISMA_URL` / `POSTGRES_PRISMA_URL`: URL pooled do PostgreSQL (Neon / Supabase).
   - `DATA_POSTGRES_URL_NON_POOLING` / `POSTGRES_URL_NON_POOLING`: URL direta do PostgreSQL.
   - `BLOB_READ_WRITE_TOKEN`: Token do Vercel Blob (para fotos em nuvem).
3. A Vercel utiliza `vercel.json` (`framework: null`, `buildCommand: "npx prisma generate"`) e empacota a API NestJS via `api/index.ts`.

---

## Execução via Docker
Para iniciar a API e um banco PostgreSQL isolado em contêineres (com backup preventivo + `prisma migrate deploy` via `scripts/safe-start.js`):
```bash
docker compose up -d
```
A API responderá na porta `3001` e o PostgreSQL na porta `5432`.
