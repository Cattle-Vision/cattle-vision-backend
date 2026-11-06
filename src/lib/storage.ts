/**
 * Motor Híbrido de Armazenamento e Otimização de Imagens (`src/lib/storage.ts`).
 *
 * Responsabilidade:
 * 1. Otimização Server-Side (`optimizeImageBuffer`):
 *    Normaliza orientação EXIF de smartphones, redimensiona para no máx 1600x1600px
 *    e codifica em JPEG progressivo (qualidade 82%).
 * 2. Upload Resiliente Multi-Camada (`storePhotoBuffer`):
 *    - Camada 1: Vercel Blob (`@vercel/blob` com private ou public access).
 *    - Camada 2: Fallback Serverless Universal para Data URI no PostgreSQL (coluna TEXT).
 * 3. Leitura Universal (`readPhotoBuffer`):
 *    - Decodifica Data URIs instantaneamente.
 *    - Busca no Vercel Blob com autenticação por token.
 *    - Suporta arquivos locais em container Docker (`/app/storage/uploads`).
 */
import path from "path";
import { promises as fs } from "fs";
import sharp from "sharp";
import { put, get, del } from "@vercel/blob";

export const STORAGE_ROOT = path.join(process.cwd(), "storage");
export const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");

export function safeJpegName(tag: string): string {
  const slug = tag.replace(/[^A-Z0-9\-_.]/gi, "_").toUpperCase() || "ANIMAL";
  return `cattle/${slug}_${Date.now()}.jpg`;
}

export async function optimizeImageBuffer(inputBuffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(inputBuffer)
      .rotate()
      .resize(1600, 1600, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 82,
        mozjpeg: true,
      })
      .toBuffer();
  } catch (err) {
    console.warn("[storage] Falha ao otimizar com sharp, usando buffer original:", (err as Error).message);
    return inputBuffer;
  }
}

function hasVercelBlobCredentials(): boolean {
  const hasReadWrite = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  const hasOidc =
    Boolean(process.env.VERCEL_OIDC_TOKEN?.trim()) &&
    Boolean(process.env.BLOB_STORE_ID?.trim());
  return hasReadWrite || hasOidc || process.env.VERCEL === "1";
}

export async function storePhotoBuffer(
  tag: string,
  rawBuffer: Buffer
): Promise<{ filePath: string; optimizedBuffer: Buffer; storageType: "vercel-blob" | "database-inline" }> {
  const optimizedBuffer = await optimizeImageBuffer(rawBuffer);
  const pathname = safeJpegName(tag);

  if (hasVercelBlobCredentials()) {
    try {
      const blob = await put(pathname, optimizedBuffer, {
        access: "private",
        contentType: "image/jpeg",
        addRandomSuffix: true,
      });
      return {
        filePath: blob.url,
        optimizedBuffer,
        storageType: "vercel-blob",
      };
    } catch (privateErr) {
      const msg = (privateErr as Error)?.message || "";
      if (msg.toLowerCase().includes("public") || msg.toLowerCase().includes("access")) {
        try {
          const pubBlob = await put(pathname, optimizedBuffer, {
            access: "public",
            contentType: "image/jpeg",
            addRandomSuffix: true,
          });
          return {
            filePath: pubBlob.url,
            optimizedBuffer,
            storageType: "vercel-blob",
          };
        } catch {
          // segue para fallback inline
        }
      }
    }
  }

  // Fallback Serverless Universal: Data URI base64 armazenado no PostgreSQL
  const base64DataUri = `data:image/jpeg;base64,${optimizedBuffer.toString("base64")}`;
  return {
    filePath: base64DataUri,
    optimizedBuffer,
    storageType: "database-inline",
  };
}

export async function readPhotoBuffer(
  filePath: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!filePath) return null;

  // 1. Data URI no banco
  if (filePath.startsWith("data:")) {
    const commaIdx = filePath.indexOf(",");
    if (commaIdx !== -1) {
      const header = filePath.slice(0, commaIdx);
      const mimeMatch = header.match(/^data:([^;]+)/);
      const contentType = mimeMatch ? mimeMatch[1] : "image/jpeg";
      const cleanBase64 = filePath.slice(commaIdx + 1).replace(/\s+/g, "");
      return {
        contentType,
        buffer: Buffer.from(cleanBase64, "base64"),
      };
    }
    return null;
  }

  // 2. Vercel Blob Storage
  if (filePath.includes(".blob.vercel-storage.com")) {
    const isPrivateUrl = filePath.includes(".private.blob.vercel-storage.com");
    const primaryAccess = isPrivateUrl ? "private" : "public";
    const secondaryAccess = isPrivateUrl ? "public" : "private";
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();

    for (const accessMode of [primaryAccess, secondaryAccess] as const) {
      try {
        const result = await get(filePath, {
          access: accessMode,
          token: blobToken,
        });
        if (result && result.statusCode === 200 && result.stream) {
          const arrayBuffer = await new Response(result.stream as unknown as ReadableStream).arrayBuffer();
          return {
            buffer: Buffer.from(arrayBuffer),
            contentType: result.blob.contentType || "image/jpeg",
          };
        }
      } catch {
        // tenta proximo modo
      }
    }

    // Fallback com fetch direto
    try {
      const headers: Record<string, string> = {};
      if (blobToken) {
        headers["Authorization"] = `Bearer ${blobToken}`;
      }
      const res = await fetch(filePath, { headers });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return {
          buffer: Buffer.from(arrayBuffer),
          contentType: res.headers.get("content-type") || "image/jpeg",
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  // 3. URLs externas
  if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
    try {
      const res = await fetch(filePath);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: res.headers.get("content-type") || "image/jpeg",
      };
    } catch {
      return null;
    }
  }

  // 4. Arquivos locais em disco
  const localPath = resolveStoredFile(filePath);
  if (!localPath) return null;
  try {
    const buffer = await fs.readFile(localPath);
    return { buffer, contentType: "image/jpeg" };
  } catch {
    return null;
  }
}

export function resolveStoredFile(filePath: string): string | null {
  if (filePath.startsWith("data:") || filePath.startsWith("http")) return null;
  const clean = filePath.replace(/^[/\\]+/, "");
  const candidates = [
    path.resolve(STORAGE_ROOT, clean.replace(/^storage[/\\]?/, "")),
    path.resolve(UPLOADS_DIR, path.basename(clean)),
    path.resolve(process.cwd(), clean),
    path.resolve(process.cwd(), "public", clean),
  ];

  for (const candidate of candidates) {
    try {
      if (require("fs").existsSync(/*turbopackIgnore: true*/ candidate)) {
        return candidate;
      }
    } catch {
      // ignora erro
    }
  }
  return null;
}

export async function ensureUploadsDir() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(() => {});
}

export async function deleteStoredFile(filePath: string) {
  if (!filePath || filePath.startsWith("data:")) return;

  if (filePath.includes(".blob.vercel-storage.com")) {
    await del(filePath).catch(() => {});
    return;
  }

  const absolute = resolveStoredFile(filePath);
  if (!absolute) return;
  await fs.unlink(absolute).catch(() => {});
}
