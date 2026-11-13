import { createConfiguredNestApp } from "./app.factory";

async function bootstrap() {
  const { expressApp } = await createConfiguredNestApp();
  const port = Number(process.env.PORT || 3001);
  expressApp.listen(port, "0.0.0.0", () => {
    console.log(`[CattleVision NestJS] API escutando em http://0.0.0.0:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error("[CattleVision NestJS] Falha fatal no bootstrap:", err);
  process.exit(1);
});
