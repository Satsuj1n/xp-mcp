import pdf from "pdf-parse/lib/pdf-parse.js";
import { readFileSync } from "node:fs";
import type { AssetClass } from "../../storage/schema.js";
import {
  buildExternalId,
  classifyAsset,
  parseNameMetadata,
} from "../../parsers/classify.js";
import { parseBRLToCents, parseQuantity } from "../../parsers/normalize.js";

/**
 * What one parsed asset row from the XPerformance PDF looks like.
 * Mirrors `ParsedPosition` from csv-extract.ts but adds `pct_allocation`
 * (which the PDF reports explicitly per asset).
 */
export interface XPerformanceParsedPosition {
  asset_class: AssetClass;
  external_id: string;
  name: string;
  quantity: number | null;
  market_value_cents: number | null;
  current_price_cents: number | null;
  pct_allocation: number | null;
  strategy: string;
  issuer: string | null;
  indexer: string | null;
  rate: string | null;
  maturity_date: string | null;
}

export interface XPerformanceParseResult {
  positions: XPerformanceParsedPosition[];
  patrimonio_total_cents: number | null;
  reference_date: string | null;
  warnings: string[];
  unrecognized_rows: number;
  total_rows: number;
}

/**
 * XP groups assets under one of these "Estratégias" in the report.
 * Order matters for prefix matching — longer first, otherwise "Pré Fixado"
 * matches a line starting with "Pré FixadoR$..." correctly but a strategy
 * named just "Pré" (hypothetical) would steal the prefix.
 */
const XP_STRATEGIES: readonly string[] = [
  "Renda Variável Brasil",
  "Renda Variável Global",
  "Fundos Listados",
  "Multimercado",
  "Pós Fixado",
  "Pré Fixado",
  "Inflação",
  "Internacional",
  "Caixa",
  "Proventos",
];

const PT_BR_MONTH: Record<string, string> = {
  JAN: "01",
  FEV: "02",
  MAR: "03",
  ABR: "04",
  MAI: "05",
  JUN: "06",
  JUL: "07",
  AGO: "08",
  SET: "09",
  OUT: "10",
  NOV: "11",
  DEZ: "12",
};

export async function parseXPerformancePdf(
  filePath: string,
): Promise<XPerformanceParseResult> {
  const buf = readFileSync(filePath);
  const data = await pdf(buf);
  const text = data.text;

  // ── Reference date (last "Data de Referência: DD/MM/YYYY" on the cover) ──
  const refDateMatch = text.match(
    /Data de Refer[êe]ncia[\s\S]*?(\d{2})\/(\d{2})\/(\d{4})/,
  );
  let referenceDate: string | null = null;
  if (refDateMatch && refDateMatch[1] && refDateMatch[2] && refDateMatch[3]) {
    referenceDate = `${refDateMatch[3]}-${refDateMatch[2]}-${refDateMatch[1]}`;
  }

  // ── Patrimônio total bruto ──
  const patrimonioMatch = text.match(
    /PATRIM[ÔO]NIO\s+TOTAL\s+BRUTO:\s*R\$\s*([\d.\s]+,\d{2})/,
  );
  const patrimonio_total_cents =
    patrimonioMatch && patrimonioMatch[1]
      ? parseBRLToCents(patrimonioMatch[1])
      : null;

  // ── Walk the text looking for the POSIÇÃO DETALHADA block(s) ──
  // The block can repeat (page-broken). We collect strategy/asset lines
  // and stop when MOVIMENTAÇÕES appears.
  const lines = text
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const warnings: string[] = [];
  const positions: XPerformanceParsedPosition[] = [];
  let totalRows = 0;
  let unrecognized = 0;

  let inBlock = false;
  let currentStrategy: string | null = null;

  for (const line of lines) {
    if (line.includes("POSIÇÃO DETALHADA DOS ATIVOS")) {
      inBlock = true;
      continue;
    }
    if (inBlock && line.startsWith("MOVIMENTAÇÕES")) {
      inBlock = false;
      continue;
    }
    if (!inBlock) continue;

    // Skip table headers, footers, page numbers, and section sub-titles
    if (
      line.startsWith("Estratégia") ||
      line.startsWith("MÊS ATUAL") ||
      line.startsWith("*Aviso") ||
      line.startsWith("PRECIFICAÇÃO") ||
      line.startsWith("Relatório informativo") ||
      line === "POSIÇÃO DETALHADA" ||
      /^\d{1,3}$/.test(line) // page number "06", "07"
    ) {
      continue;
    }

    // Strategy header? Match on canonical names.
    const strategyHit = XP_STRATEGIES.find((s) => line.startsWith(s));
    if (strategyHit) {
      // The line includes "<Strategy>R$ N.NNN,NN..." — first R$ is the strategy total.
      // We don't store it (positions sum to it); just track current bucket.
      currentStrategy = strategyHit;
      continue;
    }

    // Asset line — needs a current strategy
    if (currentStrategy === null) continue;

    totalRows++;
    const parsed = parseAssetLine(
      line,
      currentStrategy,
      patrimonio_total_cents,
    );
    if (!parsed) {
      warnings.push(`could not parse asset line: ${JSON.stringify(line)}`);
      unrecognized++;
      continue;
    }
    positions.push(parsed);
  }

  return {
    positions,
    patrimonio_total_cents,
    reference_date: referenceDate,
    warnings,
    unrecognized_rows: unrecognized,
    total_rows: totalRows,
  };
}

/**
 * Parse one asset line from the POSIÇÃO DETALHADA block.
 *
 * Lines look like (after text extraction, all columns are concatenated):
 *   "CDB BANCO XP S.A. - NOV/2027 - 100,00% CDIR$ 1.069,1713,41%0,37%100,00%4,93%100,00%--"
 *   "Tesouro Selic 2031R$ 1 4.548,84  0.7746,47%0,38%101,31%1,65%94,82%--"
 *   "BBAS3R$ 2.387,841127,63%-4,01%-1.070,30%-2,24%-45,47%--"
 *   "MXRF11R$ 1.493,391514,77%0,71%190,39%9,12%184,93%--"
 *
 * Strategy: use the patrimônio total as an anchor to compute the expected
 * %Aloc string, then split qty from %Aloc at that boundary.
 */
function parseAssetLine(
  line: string,
  strategy: string,
  patrimonioTotalCents: number | null,
): XPerformanceParsedPosition | null {
  // Find the first "R$ <amount>" — this is the saldo bruto (market value).
  const moneyRegex = /R\$\s*([\d.\s]+,\d{2})/;
  const moneyMatch = line.match(moneyRegex);
  if (!moneyMatch || moneyMatch.index === undefined || !moneyMatch[1]) {
    return null;
  }
  const market_value_cents = parseBRLToCents(moneyMatch[1]);
  if (market_value_cents == null) return null;

  const name = line.slice(0, moneyMatch.index).trim();
  if (!name) return null;

  const afterMoney = line.slice(moneyMatch.index + moneyMatch[0].length);

  // Use the patrimônio total to compute the expected %Aloc string. This lets
  // us split qty from %Aloc cleanly even when they are concatenated.
  let quantity: number | null = null;
  let pct_allocation: number | null = null;

  if (patrimonioTotalCents && patrimonioTotalCents > 0) {
    const expectedPct = (market_value_cents / patrimonioTotalCents) * 100;
    const pick = pickClosestPctToken(afterMoney, expectedPct);
    if (pick) {
      quantity = parseQuantity(pick.before);
      pct_allocation = pick.value;
    }
    // If pick is null (drift too large), we DELIBERATELY do not fall back —
    // returning null qty/pct is honest. Surface as warning if you want, but
    // never invent values.
  } else {
    // No anchor available — best-effort: first "N,NN%" wins. Less reliable.
    const fallback = afterMoney.match(/^([\d.\s]*?)(\d{1,3},\d{2})%/);
    if (fallback && fallback[1] !== undefined && fallback[2]) {
      quantity = parseQuantity(fallback[1]);
      pct_allocation = parsePtBrPct(fallback[2] + "%");
    }
  }

  const { issuer, indexer, rate, maturity_date } = parseNameMetadata(name);

  const asset_class = classifyAsset({
    strategy,
    ticker_or_name: name,
    issuer,
  });
  if (!asset_class) return null;

  // Per-unit price only meaningful for share-like assets
  let current_price_cents: number | null = null;
  if (
    (asset_class === "ACAO" ||
      asset_class === "FII" ||
      asset_class === "ETF") &&
    quantity !== null &&
    quantity > 0
  ) {
    current_price_cents = Math.round(market_value_cents / quantity);
  }

  return {
    asset_class,
    external_id: buildExternalId(asset_class, name),
    name,
    quantity,
    market_value_cents,
    current_price_cents,
    pct_allocation,
    strategy,
    issuer,
    indexer,
    rate,
    maturity_date,
  };
}

/**
 * Find the %Aloc inside a row where quantity and pct are concatenated with
 * no separator (e.g. "1514,77%..." can mean qty=151, pct=4,77% OR qty=15,
 * pct=14,77% OR qty=1, pct=514,77%).
 *
 * Strategy: enumerate every '%' position and every plausible split of the
 * integer part (1-3 digits before the comma). For each candidate, compute
 * drift from `expected` (saldo / patrimônio * 100). Return the split with
 * minimum drift — but only if it's within 0.5% of expected, otherwise null.
 *
 * Returns the slice of `s` BEFORE the chosen integer start (so caller parses
 * it as quantity) and the parsed pct value.
 */
function pickClosestPctToken(
  s: string,
  expected: number,
): { before: string; value: number } | null {
  let best: { intStart: number; value: number; drift: number } | null = null;
  const digit = (c: string | undefined) =>
    c !== undefined && c >= "0" && c <= "9";

  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "%") continue;
    // Need: [intDigits 1-3] ',' [decDigits 2] '%'
    if (i < 4) continue;
    const d1 = s[i - 1];
    const d2 = s[i - 2];
    const comma = s[i - 3];
    if (!digit(d1) || !digit(d2) || comma !== ",") continue;
    const decimalPart = `${d2}${d1}`;

    for (const intLen of [1, 2, 3] as const) {
      const intStart = i - 3 - intLen;
      if (intStart < 0) continue;
      let intPart = "";
      let valid = true;
      for (let k = 0; k < intLen; k++) {
        const ch = s[intStart + k];
        if (!digit(ch)) {
          valid = false;
          break;
        }
        intPart += ch;
      }
      if (!valid) continue;
      const value = Number(`${intPart}.${decimalPart}`);
      if (!Number.isFinite(value)) continue;
      const drift = Math.abs(value - expected);
      if (best == null || drift < best.drift) {
        best = { intStart, value, drift };
      }
    }
  }

  if (best == null || best.drift > 0.5) return null;
  return { before: s.slice(0, best.intStart), value: best.value };
}

function parsePtBrPct(s: string): number | null {
  const stripped = s.replace("%", "").replace(",", ".").trim();
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

// Re-export for tests
export const __internal = {
  PT_BR_MONTH,
  XP_STRATEGIES,
  pickClosestPctToken,
  parseAssetLine,
};
