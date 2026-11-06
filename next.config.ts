import type { NextConfig } from "next";

/**
 * Configuração do Next.js para o Backend CattleVision (`cattle-vision-backend`).
 * Otimizado para deploy Serverless na Vercel e conteinerização em Docker.
 */
const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "onnxruntime-node", "@prisma/client", "bcryptjs"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./identifier.onnx"],
  },
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@swc/core-win32-x64-msvc",
      "node_modules/@esbuild",
      "node_modules/typescript",
      "node_modules/terser",
      "node_modules/webpack",
      ".next/cache/**",
      "storage/uploads/**",
      "*.md",
    ],
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGIN || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,OPTIONS,PATCH,DELETE,POST,PUT" },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization",
          },
          { key: "Access-Control-Max-Age", value: "86400" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/upload", destination: "/api/photos/upload" },
      { source: "/api/ai/score", destination: "/api/photos/score" },
      { source: "/api/export", destination: "/api/admin/export" },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
