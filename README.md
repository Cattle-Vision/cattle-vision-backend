# CattleVision Backend

API REST, camada de persistência e motor de visão computacional da plataforma **CattleVision**, responsável pela gestão do rebanho, armazenamento de mídias, **IA de identificação/enquadramento (`identifier.onnx`)** e **IA de avaliação do Índice de Condição Corporal — ICS (`YOLO26m`)**.

> **Importante — Diferença entre CattleVision e CattleCapture**
>
> | Aspecto | **CattleVision** (`cattle-vision-backend` + `cattle-vision-frontend`) | **CattleCapture** (`cattle-capture`) |
> |---|---|---|
> | **Finalidade principal** | **Avaliação zootécnica completa com escore corporal (ICS)** | **Captura padronizada e curadoria de dataset zootécnico** |
> | **IA de Identificação / Enquadramento (`identifier.onnx` + guardas)** | **Sim** (servidor ONNX + modelos expostos para Edge AI) | **Sim** (servidor ONNX + modelos expostos para Edge AI) |
> | **IA de Avaliação de ICS (`YOLO26m` / Escala 1,0–5,0)** | **Sim** (fila persistente `IcsJob` + motor Python/ONNX) | **Não possui** (intencionalmente ausente) |
> | **Prontuário, Saúde, GPS, Guarda Compartilhada & Exportação ZIP** | **Sim** | **Sim** |
>
> Em resumo: o **CattleVision Backend** concentra toda a lógica de avaliação de **ICS (`YOLO26m`)** e fila de processamento corporal consumida pelo `cattle-vision-frontend`. Já o **CattleCapture** opera em repositório próprio como monólito dedicado exclusivamente à coleta e exportação de datasets, mantendo a IA de identificação/enquadramento e o prontuário completos, mas sem nenhuma IA ou fluxo de ICS.

---

## Arquitetura e Stack

- **Runtime & HTTP**: Node.js + Express + TypeScript
- **Banco de Dados**: PostgreSQL via Prisma ORM
- **Autenticação**: JWT (`jsonwebtoken` + `bcryptjs`)
- **Armazenamento de Mídia**: Abstração compatível com sistema de arquivos local / Cloudinary / R2 (`storage.ts`) + otimização via `sharp`
- **Visão Computacional**:
  - **Enquadramento e Guardas Semânticos**: `onnxruntime-node` com `identifier.onnx`, `version-RFB-320.onnx` e `yolo11n.onnx`
  - **Cálculo de ICS**: Worker/serviço `YOLO26m` processando fila persistente no banco (`IcsJob`)

---

## Endpoints Principais

- `/api/auth/*`: Registro, login JWT e gestão de perfil (`/api/auth/me`).
- `/api/animals/*`: CRUD de animais, leitura por tag RFID, guarda compartilhada/colaboradores, histórico de vacinas, doenças, localizações GPS e observações.
- `/api/photos/*`: Pontuação em tempo real (`/score`), upload, entrega com redimensionamento/WebP/ETag, recalibração e exclusão.
- `/api/ics/*`: Enfileiramento e drenagem da fila persistente de cálculo de ICS por foto/animal.
- `/api/admin/*`: Gestão de usuários, regeração de ICS em lote e exportação ZIP (`metadata.csv` + `manifest.json` + imagens).
- `/api/health`: Verificação de saúde do servidor e dependências de IA.

---

## Desenvolvimento Local

```bash
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```
