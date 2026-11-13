import { Injectable } from "@nestjs/common";
import { del, get, put } from "@vercel/blob";
import { existsSync, promises as fs } from "fs";
import path from "path";
import sharp from "sharp";

const STORAGE_ROOT = path.join(process.cwd(), "storage");
const UPLOADS_DIR = path.join(STORAGE_ROOT, "uploads");

/**
 * Serviço Híbrido de Armazenamento e Otimização de Imagens (`src/modules/vision/storage.service.ts`).
 */
@Injectable()
export class StorageService {
  safeJpegName(tag: string): string {
    const slug = tag.replace(/[^A-Z0-9\-_.]/gi, "_").toUpperCase() || "ANIMAL";
    return `cattle/${slug}_${Date.now()}.jpg`;
  }

  /**
   * Preserva o máximo de fidelidade e resolução para inferência consistente da IA:
   * - Se já for JPEG com orientação normal (1), até 2560px e <= 3,5 MB, mantém o buffer original sem recompressão com perdas.
   * - Caso contrário, aplica rotação EXIF e limita ao teto seguro de 2560px com JPEG qualidade 92.
   */
  async optimizeImageBuffer(inputBuffer: Buffer): Promise<Buffer> {
    try {
      const pipeline = sharp(inputBuffer);
      const meta = await pipeline.metadata();
      const maxDim = Math.max(meta.width ?? 0, meta.height ?? 0);
      const needsRotation = Boolean(meta.orientation && meta.orientation !== 1);

      if (
        meta.format === "jpeg" &&
        !needsRotation &&
        maxDim > 0 &&
        maxDim <= 2560 &&
        inputBuffer.byteLength <= 3.5 * 1024 * 1024
      ) {
        return inputBuffer;
      }

      return await sharp(inputBuffer)
        .rotate()
        .resize(2560, 2560, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({
          quality: 92,
          mozjpeg: true,
        })
        .toBuffer();
    } catch (err) {
      console.warn(
        "[storage] Falha ao otimizar com sharp, usando buffer original:",
        (err as Error).message
      );
      return inputBuffer;
    }
  }

  private hasVercelBlobCredentials(): boolean {
    const hasReadWrite = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
    const hasOidc =
      Boolean(process.env.VERCEL_OIDC_TOKEN?.trim()) &&
      Boolean(process.env.BLOB_STORE_ID?.trim());
    return hasReadWrite || hasOidc || process.env.VERCEL === "1";
  }

  async storePhotoBuffer(
    tag: string,
    rawBuffer: Buffer
  ): Promise<{
    filePath: string;
    optimizedBuffer: Buffer;
    storageType: "vercel-blob" | "database-inline";
  }> {
    const optimizedBuffer = await this.optimizeImageBuffer(rawBuffer);
    const pathname = this.safeJpegName(tag);

    if (this.hasVercelBlobCredentials()) {
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

    const base64DataUri = `data:image/jpeg;base64,${optimizedBuffer.toString("base64")}`;
    return {
      filePath: base64DataUri,
      optimizedBuffer,
      storageType: "database-inline",
    };
  }

  resolveStoredFile(filePath: string): string | null {
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
        if (existsSync(candidate)) {
          return candidate;
        }
      } catch {
        // ignora erro
      }
    }
    return null;
  }

  async readPhotoBuffer(
    filePath: string
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    if (!filePath) return null;

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

    if (filePath.includes(".blob.vercel-storage.com")) {
      const isPrivateUrl = filePath.includes(".private.blob.vercel-storage.com");
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();

      if (!isPrivateUrl) {
        try {
          const res = await fetch(filePath);
          if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            return {
              buffer: Buffer.from(arrayBuffer),
              contentType: res.headers.get("content-type") || "image/jpeg",
            };
          }
        } catch {
          // segue para SDK autenticado
        }
      }

      const primaryAccess = isPrivateUrl ? "private" : "public";
      const secondaryAccess = isPrivateUrl ? "public" : "private";

      for (const accessMode of [primaryAccess, secondaryAccess] as const) {
        try {
          const result = await get(filePath, {
            access: accessMode,
            token: blobToken,
          });
          if (result && result.statusCode === 200 && result.stream) {
            const arrayBuffer = await new Response(
              result.stream as unknown as ReadableStream
            ).arrayBuffer();
            return {
              buffer: Buffer.from(arrayBuffer),
              contentType: result.blob.contentType || "image/jpeg",
            };
          }
        } catch {
          // tenta próximo modo
        }
      }

      if (blobToken) {
        try {
          const res = await fetch(filePath, {
            headers: { Authorization: `Bearer ${blobToken}` },
          });
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
      }

      return null;
    }

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

    const localPath = this.resolveStoredFile(filePath);
    if (!localPath) return null;
    try {
      const buffer = await fs.readFile(localPath);
      return { buffer, contentType: "image/jpeg" };
    } catch {
      return null;
    }
  }

  async deleteStoredFile(filePath: string): Promise<void> {
    if (!filePath || filePath.startsWith("data:")) return;

    if (filePath.includes(".blob.vercel-storage.com")) {
      await del(filePath).catch(() => {});
      return;
    }

    const absolute = this.resolveStoredFile(filePath);
    if (!absolute) return;
    await fs.unlink(absolute).catch(() => {});
  }
}
