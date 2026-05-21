import type { Fundamentals, Quote } from "./market-data/source.js";

export type SortField =
  | "dividend_yield"
  | "pvp"
  | "pl"
  | "roe"
  | "price_change_30d"
  | "market_cap";

export interface ScreenCriteria {
  sort_by: SortField;
  order: "asc" | "desc";
  filters: {
    min_market_cap_brl?: number;
    max_pvp?: number;
    min_dividend_yield_pct?: number;
    min_roe_pct?: number;
    max_vacancy_pct?: number;
  };
  limit: number;
}

export interface Candidate {
  ticker: string;
  quote: Quote;
  fundamentals: Fundamentals;
}

export interface ScreenInput {
  candidates: Candidate[];
  criteria: ScreenCriteria;
  excluded_tickers: string[];
}

export interface ScreenResult {
  ticker: string;
  quote: Quote;
  fundamentals: Fundamentals;
  score: number;
  why: string;
}

function fieldValue(c: Candidate, field: SortField): number | null {
  switch (field) {
    case "dividend_yield":
      return c.fundamentals.dividend_yield_pct;
    case "pvp":
      return c.fundamentals.pvp_ratio;
    case "pl":
      return c.fundamentals.pl_ratio;
    case "roe":
      return c.fundamentals.roe_pct;
    case "price_change_30d":
      return c.quote.change_pct;
    case "market_cap":
      return c.quote.market_cap_brl;
  }
}

function passesFilters(c: Candidate, f: ScreenCriteria["filters"]): boolean {
  if (
    f.min_market_cap_brl != null &&
    (c.quote.market_cap_brl == null ||
      c.quote.market_cap_brl < f.min_market_cap_brl)
  )
    return false;
  if (
    f.max_pvp != null &&
    (c.fundamentals.pvp_ratio == null || c.fundamentals.pvp_ratio > f.max_pvp)
  )
    return false;
  if (
    f.min_dividend_yield_pct != null &&
    (c.fundamentals.dividend_yield_pct == null ||
      c.fundamentals.dividend_yield_pct < f.min_dividend_yield_pct)
  )
    return false;
  if (
    f.min_roe_pct != null &&
    (c.fundamentals.roe_pct == null || c.fundamentals.roe_pct < f.min_roe_pct)
  )
    return false;
  if (
    f.max_vacancy_pct != null &&
    (c.fundamentals.vacancy_pct == null ||
      c.fundamentals.vacancy_pct > f.max_vacancy_pct)
  )
    return false;
  return true;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function labelFor(field: SortField): string {
  switch (field) {
    case "dividend_yield":
      return "DY";
    case "pvp":
      return "P/VP";
    case "pl":
      return "P/L";
    case "roe":
      return "ROE";
    case "price_change_30d":
      return "Δ30d";
    case "market_cap":
      return "MarketCap";
  }
}

function formatVal(field: SortField, n: number): string {
  if (field === "market_cap") return n.toFixed(0);
  if (
    field === "dividend_yield" ||
    field === "roe" ||
    field === "price_change_30d"
  )
    return `${n.toFixed(1)}%`;
  return n.toFixed(2);
}

export function screen(input: ScreenInput): ScreenResult[] {
  const { candidates, criteria, excluded_tickers } = input;
  const excludeSet = new Set(excluded_tickers);

  const filtered = candidates
    .filter((c) => !excludeSet.has(c.ticker))
    .filter((c) => passesFilters(c, criteria.filters));

  const withValue = filtered.map((c) => ({
    c,
    v: fieldValue(c, criteria.sort_by),
  }));

  const sorted = [...withValue].sort((a, b) => {
    const av = a.v;
    const bv = b.v;
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // nulls last
    if (bv == null) return -1;
    return criteria.order === "desc" ? bv - av : av - bv;
  });

  const limited = sorted.slice(0, criteria.limit);

  const nonNullVals = limited
    .map((x) => x.v)
    .filter((v): v is number => v != null);
  const med = median(nonNullVals);
  const max = nonNullVals.length > 0 ? Math.max(...nonNullVals) : 0;
  const min = nonNullVals.length > 0 ? Math.min(...nonNullVals) : 0;
  const span = max - min;

  return limited.map(({ c, v }) => {
    let score: number;
    if (v == null) {
      score = 0;
    } else if (span === 0) {
      score = 1;
    } else if (criteria.order === "desc") {
      score = (v - min) / span;
    } else {
      score = (max - v) / span;
    }
    const label = labelFor(criteria.sort_by);
    const why =
      v == null
        ? `${label} indisponível`
        : `${label} ${formatVal(criteria.sort_by, v)} (median ${formatVal(criteria.sort_by, med)})`;
    return {
      ticker: c.ticker,
      quote: c.quote,
      fundamentals: c.fundamentals,
      score: Number(score.toFixed(4)),
      why,
    };
  });
}
