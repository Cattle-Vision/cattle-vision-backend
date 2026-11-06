export function normalizeTag(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidTag(tag: string): boolean {
  return /^[A-Z0-9][A-Z0-9\-_.]{1,31}$/.test(tag);
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
