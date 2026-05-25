import type { AssetClass } from "../storage/schema.js";

/**
 * Inputs available to the classifier. All optional except `ticker_or_name`.
 * Different parsers (CSV vs XPerformance PDF) populate different subsets.
 */
export interface ClassifyInput {
  /** Explicit class column from a CSV (e.g., "Ação", "Fundo Imobiliário"). */
  raw_class?: string | null;
  /** XP "estratégia" bucket (e.g., "Pós Fixado", "Renda Variável Brasil"). */
  strategy?: string | null;
  /** Ticker or canonical asset name. Always present. */
  ticker_or_name: string;
  /** Emissor / instituição emissora, when available. */
  issuer?: string | null;
  /** Indexer hint when explicit (CDI, SELIC, IPCA, PRE). */
  indexer?: string | null;
  /** Maturity hint, raw string. */
  maturity?: string | null;
}

/**
 * Known B3 ETF tickers. Tickers ending in "11" are AMBIGUOUS — could be FII or ETF.
 * Hardcoding the well-known ETFs lets us classify the residual "11" as FII.
 *
 * TODO: extend this list as the user's portfolio grows.
 * Source: BMF/B3 listed ETFs, May 2026.
 */
const KNOWN_ETF_TICKERS: ReadonlySet<string> = new Set([
  "BOVA11",
  "IVVB11",
  "SMAL11",
  "DIVO11",
  "BBSD11",
  "ECOO11",
  "GOVE11",
  "PIBB11",
  "BOVB11",
  "BOVV11",
  "FIND11",
  "MATB11",
  "ISUS11",
  "ESGB11",
  "SPXI11",
  "XINA11",
  "ASIA11",
  "EURP11",
  "NASD11",
  "GLOB11",
  "ACWI11",
  "HASH11",
  "DEFI11",
  "QBTC11",
]);

const MONTH_PT: Record<string, string> = {
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

/**
 * Classify an asset into one of the AssetClass values.
 *
 * Rules ordered by signal strength (strongest first). Returns null when ambiguous
 * so the import surfaces a warning rather than guessing.
 */
export function classifyAsset(input: ClassifyInput): AssetClass | null {
  const name = input.ticker_or_name.trim();
  const upper = name.toUpperCase();
  const rawClass = (input.raw_class ?? "").toLowerCase();
  const strategy = (input.strategy ?? "").toLowerCase();
  const issuer = (input.issuer ?? "").toLowerCase();

  // 1) Explicit class column from CSV — highest priority
  if (rawClass.includes("imobil")) return "FII";
  if (rawClass.includes("etf")) return "ETF";
  if (
    rawClass === "ação" ||
    rawClass === "acao" ||
    rawClass.includes("ações") ||
    rawClass.includes("acoes")
  ) {
    return "ACAO";
  }
  if (rawClass.includes("tesouro")) return "TESOURO";

  // 2) Tesouro Direto — strong signals on name/issuer
  if (upper.includes("TESOURO") || issuer.includes("tesouro nacional")) {
    return "TESOURO";
  }

  // 3) Private fixed income (CDB / LCI / LCA / Debênture / CRA / CRI / LF)
  if (
    upper.startsWith("CDB") ||
    upper.includes(" CDB ") ||
    upper.startsWith("LCI") ||
    upper.startsWith("LCA") ||
    upper.startsWith("LF ") ||
    upper.includes("DEBÊNTURE") ||
    upper.includes("DEBENTURE") ||
    upper.includes(" CRA ") ||
    upper.includes(" CRI ") ||
    upper.startsWith("CRA ") ||
    upper.startsWith("CRI ")
  ) {
    return "RENDA_FIXA_PRIVADA";
  }

  // 4) Investment fund (FIF, FIC, FIM, FIA, FIQ, FIDC, FIP) — NOT FII
  const looksLikeFund =
    upper.includes(" FIF") ||
    upper.includes(" FIC") ||
    upper.includes(" FIM") ||
    upper.includes(" FIA") ||
    upper.includes(" FIQ") ||
    upper.includes("FIDC") ||
    upper.includes("FIP ") ||
    upper.startsWith("FIF ") ||
    upper.startsWith("FIC ") ||
    upper.includes("REFERENCIADO") ||
    upper.includes("MULTIMERCADO") ||
    /\bFUNDO\b/i.test(name);
  const looksLikeFII = upper.endsWith("11") && /^[A-Z]{4}11$/.test(upper);
  if (looksLikeFund && !looksLikeFII && !upper.includes("IMOBIL")) {
    return "FUNDO";
  }

  // 5) Listed assets by ticker shape
  const tickerMatch = upper.match(/^([A-Z]{4})(\d{1,2})$/);
  if (tickerMatch) {
    const digits = tickerMatch[2];
    if (digits === "11") {
      return KNOWN_ETF_TICKERS.has(upper) ? "ETF" : "FII";
    }
    if (digits === "3" || digits === "4" || digits === "5" || digits === "6") {
      return "ACAO";
    }
  }

  // 6) Strategy fallback (weak signal)
  if (
    strategy.includes("renda variável") ||
    strategy.includes("renda variavel")
  ) {
    return "ACAO";
  }

  return null;
}

/**
 * Extract structured metadata from a free-form asset name.
 * Knows about Tesouro and CDB patterns; returns nulls when nothing matches.
 *
 * Example inputs:
 *  - "Tesouro Selic 2031"
 *  - "CDB BANCO XP S.A. - NOV/2027 - 100,00% CDI"
 *  - "CDB BANCO XP S.A. - AGO/2026 - 15,00%"
 *  - "XP Referenciado FIF RF Referenciado DI CP RL"
 */
export interface NameMetadata {
  issuer: string | null;
  indexer: string | null;
  rate: string | null;
  maturity_date: string | null;
}

export function parseNameMetadata(name: string): NameMetadata {
  // Tesouro Direto
  if (/Tesouro/i.test(name)) {
    let indexer: string | null = null;
    if (/Selic/i.test(name)) indexer = "SELIC";
    else if (/IPCA/i.test(name)) indexer = "IPCA";
    else if (/Prefixado|Pr[éE]/i.test(name)) indexer = "PRE";
    const yearMatch = name.match(/(\d{4})/);
    return {
      issuer: "Tesouro Nacional",
      indexer,
      rate: null,
      // Tesouro pays at year-end in practice; we use Dec-31 as a stable canonical date.
      maturity_date: yearMatch ? `${yearMatch[1]}-12-31` : null,
    };
  }

  // CDB / LCI / LCA: "TIPO EMISSOR - MES/ANO - TAXA"
  const rfMatch = name.match(
    /^(CDB|LCI|LCA|LF|LCD)\s+(.+?)\s+-\s+([A-Z]{3})\/(\d{4})\s+-\s+(.+)$/i,
  );
  if (rfMatch && rfMatch[2] && rfMatch[3] && rfMatch[4] && rfMatch[5]) {
    const issuerRaw = rfMatch[2];
    const monthBr = rfMatch[3];
    const year = rfMatch[4];
    const rateText = rfMatch[5];
    const mm = MONTH_PT[monthBr.toUpperCase()] ?? "01";
    const indexer = /CDI/i.test(rateText) ? "CDI" : "PRE";
    return {
      issuer: issuerRaw.trim(),
      indexer,
      rate: rateText.trim(),
      maturity_date: `${year}-${mm}-15`, // CDBs usually mature mid-month
    };
  }

  return { issuer: null, indexer: null, rate: null, maturity_date: null };
}

/**
 * Build a stable external_id for a position.
 *  - Listed assets (ACAO/FII/ETF): the ticker uppercased
 *  - Others: canonical (uppercased, whitespace-collapsed) name
 */
export function buildExternalId(assetClass: AssetClass, name: string): string {
  if (assetClass === "ACAO" || assetClass === "FII" || assetClass === "ETF") {
    const upper = name.trim().toUpperCase();
    const tickerOnly = upper.match(/^[A-Z]{4}\d{1,2}/)?.[0];
    if (tickerOnly) return tickerOnly;
  }
  return name.replace(/\s+/g, " ").trim().toUpperCase();
}
