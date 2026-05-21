import type { AssetClass } from "../../storage/schema.js";

export interface Quote {
  ticker: string;
  price_brl: number;
  change_pct: number;
  volume: number;
  market_cap_brl: number | null;
  updated_at: string; // ISO 8601 from source
}

export interface Fundamentals {
  ticker: string;
  dividend_yield_pct: number | null;
  pl_ratio: number | null;
  pvp_ratio: number | null;
  roe_pct: number | null;
  vacancy_pct: number | null; // FII-specific; null for non-FII
  updated_at: string;
}

export interface UniverseListItem {
  ticker: string;
  name: string;
  asset_class: AssetClass;
}

export type UniverseClass = Extract<AssetClass, "FII" | "ACAO" | "ETF">;

export interface MarketDataSource {
  readonly name: string;
  getQuote(ticker: string): Promise<Quote>;
  getFundamentals(ticker: string): Promise<Fundamentals>;
  listUniverse(assetClass: UniverseClass): Promise<UniverseListItem[]>;
}
