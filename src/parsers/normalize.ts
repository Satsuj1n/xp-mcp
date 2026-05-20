/**
 * Helpers to normalize raw values from XP CSVs into the typed shape our DB expects.
 * Brazilian conventions: decimal comma, R$ prefix, thousands "." separator.
 */

/**
 * Parse "R$ 1.234,56" / "1.234,56" / "1234.56" → 123456 (cents).
 * Returns null when the input is empty or unparseable.
 */
export function parseBRLToCents(
  input: string | undefined | null,
): number | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (raw === "" || raw === "-") return null;

  const cleaned = raw
    .replace(/R\$\s*/gi, "")
    .replace(/\s/g, "")
    .replace(/[^\d,.-]/g, "");

  const num = brazilianNumberToFloat(cleaned);
  if (num == null) return null;
  return Math.round(num * 100);
}

/**
 * Parse "1.234,56" / "1234.56" / "0,5" → 0.5 (number, not cents).
 * Used for quantities (which can be fractional, e.g. fractional shares of FII).
 */
export function parseQuantity(input: string | undefined | null): number | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (raw === "" || raw === "-") return null;

  const cleaned = raw.replace(/\s/g, "").replace(/[^\d,.-]/g, "");
  return brazilianNumberToFloat(cleaned);
}

function brazilianNumberToFloat(cleaned: string): number | null {
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized: string;
  if (hasComma && hasDot) {
    // If both present, the rightmost is the decimal separator.
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned;
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse "15/05/2035" / "2035-05-15" / "15-05-2035" → "2035-05-15" (ISO).
 */
export function parseDateBR(input: string | undefined | null): string | null {
  if (input == null) return null;
  const raw = String(input).trim();
  if (raw === "") return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return raw;

  const brMatch = raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;

  return null;
}

/**
 * Normalize a header cell: lowercase, strip accents, collapse spaces.
 * Useful for fuzzy column matching since XP changes header casing/wording.
 */
export function normalizeHeader(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
