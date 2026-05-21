import Papa from "papaparse";
import { readFileSync } from "node:fs";
import type { AssetClass } from "../../storage/schema.js";
import { classifyAsset } from "../../parsers/classify.js";
import {
  normalizeHeader,
  parseBRLToCents,
  parseDateBR,
  parseQuantity,
} from "../../parsers/normalize.js";

/**
 * One row of the normalized extract — what a parsed CSV row becomes
 * before we upsert into the `positions` table.
 */
export interface ParsedPosition {
  asset_class: AssetClass;
  external_id: string; // ticker, ISIN, or stable internal id
  name: string;
  quantity: number | null;
  avg_price_cents: number | null;
  current_price_cents: number | null;
  invested_cents: number | null;
  market_value_cents: number | null;
  issuer: string | null;
  indexer: string | null;
  rate: string | null;
  maturity_date: string | null;
  has_fgc: boolean | null;
}

export interface ParseResult {
  positions: ParsedPosition[];
  warnings: string[];
  unrecognized_rows: number;
  total_rows: number;
}

/**
 * Map of normalized header → list of candidate header strings (also normalized).
 * If the CSV header (after normalization) matches ANY candidate, we treat it as
 * that field. We accept many variants because XP renames columns between exports.
 *
 * NOTE: this is a best-effort starting point. When the user provides a real CSV,
 * extend the candidates list and tighten the matching.
 */
const HEADER_ALIASES: Record<string, readonly string[]> = {
  ticker: [
    "ticker",
    "codigo",
    "codigo do ativo",
    "codigo de negociacao",
    "produto",
  ],
  name: ["nome", "descricao", "ativo", "papel", "produto"],
  quantity: ["quantidade", "qtde", "qtd", "quantidade disponivel"],
  avg_price: [
    "preco medio",
    "preco de aquisicao",
    "preco de compra",
    "custo medio",
  ],
  current_price: [
    "preco atual",
    "ultima cotacao",
    "cotacao",
    "preco de mercado",
    "preco unitario atual",
  ],
  invested: [
    "valor aplicado",
    "valor investido",
    "valor de compra",
    "valor total aplicado",
  ],
  market_value: [
    "valor atual",
    "valor de mercado",
    "saldo bruto",
    "valor liquido",
    "posicao",
  ],
  issuer: ["emissor", "instituicao emissora", "banco emissor"],
  indexer: ["indexador", "indice", "tipo de rentabilidade"],
  rate: ["taxa", "taxa contratada", "rentabilidade"],
  maturity: ["vencimento", "data de vencimento", "data vencimento"],
  asset_class: ["classe", "tipo", "categoria", "produto"],
};

/**
 * Match a row's value at the first candidate header that exists.
 * Returns the trimmed string, or undefined when none of the candidates match.
 */
function pick(
  row: Record<string, string>,
  normalizedHeaders: Map<string, string>,
  key: keyof typeof HEADER_ALIASES,
): string | undefined {
  const candidates = HEADER_ALIASES[key];
  if (!candidates) return undefined;
  for (const candidate of candidates) {
    const realHeader = normalizedHeaders.get(candidate);
    if (realHeader && row[realHeader] != null && row[realHeader] !== "") {
      return row[realHeader].trim();
    }
  }
  return undefined;
}

/**
 * Build a map from normalized header → original header string,
 * so we can look up values regardless of casing/accents/spacing.
 */
function buildHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    map.set(normalizeHeader(h), h);
  }
  return map;
}

export function parseExtractCsv(filePath: string): ParseResult {
  const raw = readFileSync(filePath, "utf8");

  // XP CSVs are usually `;`-delimited (BR locale). Papa auto-detects, but we
  // pass delimitersToGuess to be explicit.
  const parsed = Papa.parse<Record<string, string>>(raw, {
    header: true,
    skipEmptyLines: true,
    delimitersToGuess: [";", ",", "\t", "|"],
  });

  const warnings: string[] = [];
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      warnings.push(
        `csv: ${err.type} at row ${err.row ?? "?"}: ${err.message}`,
      );
    }
  }

  const headers = parsed.meta.fields ?? [];
  const normalizedHeaders = buildHeaderMap(headers);

  const positions: ParsedPosition[] = [];
  let unrecognized = 0;

  for (const row of parsed.data) {
    const tickerOrName =
      pick(row, normalizedHeaders, "ticker") ??
      pick(row, normalizedHeaders, "name");
    if (!tickerOrName) {
      unrecognized++;
      continue;
    }

    const assetClass = classifyAsset({
      raw_class: pick(row, normalizedHeaders, "asset_class"),
      ticker_or_name: tickerOrName,
      issuer: pick(row, normalizedHeaders, "issuer") ?? null,
      indexer: pick(row, normalizedHeaders, "indexer") ?? null,
      maturity: pick(row, normalizedHeaders, "maturity") ?? null,
    });

    if (!assetClass) {
      warnings.push(
        `row skipped — could not classify asset: ${JSON.stringify(row)}`,
      );
      unrecognized++;
      continue;
    }

    positions.push({
      asset_class: assetClass,
      external_id: (
        pick(row, normalizedHeaders, "ticker") ?? tickerOrName
      ).toUpperCase(),
      name: pick(row, normalizedHeaders, "name") ?? tickerOrName,
      quantity: parseQuantity(pick(row, normalizedHeaders, "quantity")),
      avg_price_cents: parseBRLToCents(
        pick(row, normalizedHeaders, "avg_price"),
      ),
      current_price_cents: parseBRLToCents(
        pick(row, normalizedHeaders, "current_price"),
      ),
      invested_cents: parseBRLToCents(pick(row, normalizedHeaders, "invested")),
      market_value_cents: parseBRLToCents(
        pick(row, normalizedHeaders, "market_value"),
      ),
      issuer: pick(row, normalizedHeaders, "issuer") ?? null,
      indexer: pick(row, normalizedHeaders, "indexer") ?? null,
      rate: pick(row, normalizedHeaders, "rate") ?? null,
      maturity_date: parseDateBR(pick(row, normalizedHeaders, "maturity")),
      has_fgc: inferFgc(assetClass),
    });
  }

  return {
    positions,
    warnings,
    unrecognized_rows: unrecognized,
    total_rows: parsed.data.length,
  };
}

/**
 * Whether an asset class is typically covered by FGC (Fundo Garantidor de Créditos).
 * Tesouro is NOT — sovereign credit covers it (effectively safer than FGC).
 */
function inferFgc(assetClass: AssetClass): boolean | null {
  if (assetClass === "RENDA_FIXA_PRIVADA") return true;
  if (assetClass === "TESOURO") return false;
  return null;
}
