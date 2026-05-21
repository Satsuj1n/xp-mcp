import { z } from "zod";
import { AdvisorError } from "../advisor/errors.js";
import { requireOutboundEnabled } from "../advisor/profile.js";
import { BrapiSource } from "../advisor/market-data/brapi.js";
import { MarketDataCache } from "../advisor/market-data/cache.js";
import type {
  Fundamentals,
  MarketDataSource,
  Quote,
} from "../advisor/market-data/source.js";
import { getDb } from "../storage/db.js";

export const DISCLAIMER =
  "[disclaimer] Análise educacional baseada em dados públicos. Não constitui recomendação de investimento. Decisões financeiras são de sua responsabilidade.";

const includeEnum = z.enum(["quote", "fundamentals"]);

export const getMarketDataSchema = z.object({
  tickers: z
    .array(z.string().regex(/^[A-Z0-9]{4,6}$/))
    .min(1)
    .max(50)
    .describe("Ticker symbols (e.g. ['BBAS3','MXRF11']). 1-50 entries."),
  include: z
    .array(includeEnum)
    .min(1)
    .default(["quote"])
    .describe("Which data points to fetch per ticker. Default: ['quote']."),
  cache_ttl_minutes: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Override default TTL: 60 for quote, 1440 for fundamentals. 0 forces a fresh fetch.",
    ),
});

export type GetMarketDataInput = z.infer<typeof getMarketDataSchema>;

const DEFAULT_TTL_MIN = { quote: 60, fundamentals: 1440 } as const;

interface PerTickerResult {
  ticker: string;
  quote: Quote | null;
  fundamentals: Fundamentals | null;
  error: { code: string; message: string; recoverable: boolean } | null;
}

export interface GetMarketDataResult {
  ok: boolean;
  source: string;
  results: PerTickerResult[];
  warnings: string[];
}

export interface GetMarketDataDeps {
  source?: MarketDataSource;
  cache?: MarketDataCache;
}

function errorToShape(e: unknown): PerTickerResult["error"] {
  if (e instanceof AdvisorError) {
    return { code: e.code, message: e.message, recoverable: e.recoverable };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "UNKNOWN", message: msg, recoverable: false };
}

export async function getMarketData(
  input: GetMarketDataInput,
  deps: GetMarketDataDeps = {},
): Promise<GetMarketDataResult> {
  const profile = await requireOutboundEnabled();
  const source = deps.source ?? new BrapiSource({ token: profile.brapi_token });
  const cache = deps.cache ?? new MarketDataCache(getDb());

  const include = input.include ?? ["quote"];
  const results: PerTickerResult[] = [];

  for (const ticker of input.tickers) {
    const row: PerTickerResult = {
      ticker,
      quote: null,
      fundamentals: null,
      error: null,
    };
    try {
      if (include.includes("quote")) {
        const ttl = input.cache_ttl_minutes ?? DEFAULT_TTL_MIN.quote;
        const cached = ttl > 0 ? cache.get<Quote>(ticker, "quote", ttl) : null;
        if (cached) {
          row.quote = cached.data;
        } else {
          const fresh = await source.getQuote(ticker);
          cache.put(ticker, "quote", fresh);
          row.quote = fresh;
        }
      }
      if (include.includes("fundamentals")) {
        const ttl = input.cache_ttl_minutes ?? DEFAULT_TTL_MIN.fundamentals;
        const cached =
          ttl > 0 ? cache.get<Fundamentals>(ticker, "fundamentals", ttl) : null;
        if (cached) {
          row.fundamentals = cached.data;
        } else {
          const fresh = await source.getFundamentals(ticker);
          cache.put(ticker, "fundamentals", fresh);
          row.fundamentals = fresh;
        }
      }
    } catch (e) {
      row.error = errorToShape(e);
    }
    results.push(row);
  }

  return {
    ok: true,
    source: source.name,
    results,
    warnings: [DISCLAIMER],
  };
}
