# CattleVision Backend

Serviço de API RESTful, Inferência de Visão Computacional (YOLOv8 ONNX) e Gerenciamento do Dataset de ICS Bovino.

---

## Recursos Arquiteturais
- **Inferência YOLOv8 ONNX Dinâmica**: Análise da região posterior bovina com stride 32 e suporte a resoluções > 512x512 e aspect ratios livres.
- **Suporte Multi-Origem e CORS Dinâmico**: Permite que o frontend rode em outra máquina, em rede local Wi-Fi rural, na nuvem Vercel ou em Docker.
- **Autenticação Stateless JWT**: Comunicação desacoplada via header `Authorization: Bearer <token>`, eliminando problemas de third-party cookies cross-domain.
- **Armazenamento Híbrido Resiliente**: Vercel Blob Storage com fallback automático para Base64 no PostgreSQL ou armazenamento local.
- **Prisma ORM**: Suporte a PostgreSQL gerenciado (Neon, Supabase) ou contêiner local.

---

## Configuração Rápida

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Configure o arquivo `.env`:
   ```bash
   cp .env.example .env
   ```

3. Sincronize o banco de dados e gere o Prisma Client:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. Inicie o servidor:
   ```bash
   npm run dev
   ```
   A API estará acessível em `http://localhost:3001` (endpoint de saúde: `http://localhost:3001/api/health`).

---

## Deploy na Vercel
1. Conecte o repositório `cattle-vision-backend` na Vercel.
2. Configure as variáveis de ambiente em **Project Settings > Environment Variables**:
   - `CORS_ORIGIN`: URL do seu frontend (ex: `https://meu-frontend.vercel.app` ou `*`).
   - `AUTH_SECRET`: Segredo JWT de produção.
   - `DATA_POSTGRES_PRISMA_URL`: URL do PostgreSQL (Neon / Supabase).
   - `DATA_POSTGRES_URL_NON_POOLING`: URL direta do PostgreSQL.
3. A Vercel executará automaticamente `next build` e provisionará as rotas em Serverless Functions.

---

## Execução via Docker
Para iniciar a API e um banco PostgreSQL isolado em contêineres:
```bash
docker compose up -d
```
A API responderá na porta `3001` e o PostgreSQL na porta `5432`.
