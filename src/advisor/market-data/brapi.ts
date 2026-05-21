import { TickerNotFoundError } from "../errors.js";
import { fetchWithRetry } from "./fetch.js";
import type {
  Fundamentals,
  MarketDataSource,
  Quote,
  UniverseClass,
  UniverseListItem,
} from "./source.js";

const BASE = "https://brapi.dev/api";

interface BrapiQuoteResult {
  symbol: string;
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  marketCap: number | null;
  regularMarketTime: string;
  defaultKeyStatistics?: {
    trailingDividendYield?: number;
    priceToBook?: number;
  };
  summaryDetail?: { trailingPE?: number };
  financialData?: { returnOnEquity?: number };
  vacancyRate?: number;
}

interface BrapiQuoteEnvelope {
  results?: BrapiQuoteResult[];
}

interface BrapiUniverseItem {
  stock: string;
  name: string;
  type: string;
}

interface BrapiUniverseEnvelope {
  stocks?: BrapiUniverseItem[];
}

const UNIVERSE_TYPE_PARAM: Record<UniverseClass, string> = {
  FII: "fund",
  ACAO: "stock",
  ETF: "etf",
};

export interface BrapiSourceOptions {
  token?: string;
  timeout_ms?: number;
  max_retries?: number;
}

export class BrapiSource implements MarketDataSource {
  readonly name = "brapi.dev";

  constructor(private readonly opts: BrapiSourceOptions = {}) {}

  private withToken(url: string): string {
    if (!this.opts.token) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}token=${encodeURIComponent(this.opts.token)}`;
  }

  private async fetchJson(url: string): Promise<unknown> {
    return fetchWithRetry(this.withToken(url), {
      timeout_ms: this.opts.timeout_ms,
      max_retries: this.opts.max_retries,
    });
  }

  async getQuote(ticker: string): Promise<Quote> {
    const env = (await this.fetchJson(
      `${BASE}/quote/${encodeURIComponent(ticker)}`,
    )) as BrapiQuoteEnvelope;
    const r = env.results?.[0];
    if (!r) throw new TickerNotFoundError(ticker);
    return {
      ticker: r.symbol,
      price_brl: r.regularMarketPrice,
      change_pct: r.regularMarketChangePercent,
      volume: r.regularMarketVolume,
      market_cap_brl: r.marketCap ?? null,
      updated_at: r.regularMarketTime,
    };
  }

  async getFundamentals(ticker: string): Promise<Fundamentals> {
    const env = (await this.fetchJson(
      `${BASE}/quote/${encodeURIComponent(ticker)}?fundamental=true`,
    )) as BrapiQuoteEnvelope;
    const r = env.results?.[0];
    if (!r) throw new TickerNotFoundError(ticker);
    const toPct = (n: number | undefined | null): number | null =>
      n == null ? null : Number((n * 100).toFixed(4));
    return {
      ticker: r.symbol,
      dividend_yield_pct: toPct(r.defaultKeyStatistics?.trailingDividendYield),
      pl_ratio: r.summaryDetail?.trailingPE ?? null,
      pvp_ratio: r.defaultKeyStatistics?.priceToBook ?? null,
      roe_pct: toPct(r.financialData?.returnOnEquity),
      vacancy_pct:
        r.vacancyRate == null ? null : Number((r.vacancyRate * 100).toFixed(4)),
      updated_at: r.regularMarketTime,
    };
  }

  async listUniverse(assetClass: UniverseClass): Promise<UniverseListItem[]> {
    const param = UNIVERSE_TYPE_PARAM[assetClass];
    const env = (await this.fetchJson(
      `${BASE}/quote/list?type=${param}`,
    )) as BrapiUniverseEnvelope;
    return (env.stocks ?? []).map((s) => ({
      ticker: s.stock,
      name: s.name,
      asset_class: assetClass,
    }));
  }
}
