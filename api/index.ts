import type { Request, Response } from "express";
import type { Express } from "express";
import { createConfiguredNestApp } from "../src/app.factory";

let cachedAppPromise: Promise<Express> | null = null;

async function getServerlessApp(): Promise<Express> {
  if (!cachedAppPromise) {
    cachedAppPromise = createConfiguredNestApp().then(({ expressApp }) => expressApp);
  }
  return cachedAppPromise;
}

/**
 * Handler Serverless da Vercel (`api/index.ts`) para a API NestJS.
 */
export default async function handler(req: Request, res: Response): Promise<void> {
  const app = await getServerlessApp();
  app(req, res);
}
