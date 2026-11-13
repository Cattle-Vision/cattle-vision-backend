import { BadRequestException } from "@nestjs/common";

/**
 * Utilitários de Normalização e Validação Zootécnica (`src/common/utils/animal.utils.ts`).
 */
export function normalizeTag(raw: string): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function isValidTag(tag: string): boolean {
  return /^[A-Z0-9][A-Z0-9\-_.]{1,31}$/.test(tag);
}

/**
 * Converte e valida uma coordenada geográfica WGS84 (latitude ou longitude).
 * Aceita vírgula decimal pt-BR ou ponto e retorna `null` quando vazia.
 */
export function parseOptionalCoordinate(
  raw: unknown,
  min: number,
  max: number,
  label: string
): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const normalized = String(raw).trim().replace(",", ".");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new BadRequestException(`${label} inválida. Informe um valor entre ${min} e ${max}.`);
  }
  return Math.round(parsed * 1_000_000) / 1_000_000;
}

export const BREEDS = [
  "Nelore",
  "Angus",
  "Brahman",
  "Gir",
  "Guzerá",
  "Tabapuã",
  "Senepol",
  "Hereford",
  "Charolês",
  "Cruzado",
  "Outra",
] as const;

export const SEX_OPTIONS = [
  { value: "Fêmea", label: "Fêmea (vaca / novilha)" },
  { value: "Macho", label: "Macho (boi / touro / novilho)" },
] as const;
