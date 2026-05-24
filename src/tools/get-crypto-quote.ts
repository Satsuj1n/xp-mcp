import { z } from "zod";
import { AdvisorError } from "../advisor/errors.js";
import { requireOutboundEnabled } from "../advisor/profile.js";
import { MercadoBitcoinSource } from "../advisor/market-data/crypto-source.js";
import { MarketDataCache } from "../advisor/market-data/cache.js";
import type {
  CryptoQuote,
  CryptoQuoteSource,
} from "../advisor/market-data/crypto-source.js";
import { getDb } from "../storage/db.js";

export const DISCLAIMER =
  "[disclaimer] Análise educacional baseada em dados públicos. Não constitui recomendação de investimento. Decisões financeiras são de sua responsabilidade.";

export const getCryptoQuoteSchema = z.object({
  tickers: z
    .array(z.string().regex(/^[A-Z0-9]{2,10}$/))
    .min(1)
    .max(20)
    .describe("Crypto symbols, uppercase (e.g. ['BTC','ETH']). 1-20."),
  cache_ttl_minutes: z
    .number()
    .nonnegative()
    .optional()
    .describe("Override default TTL (15 min). 0 forces a fresh fetch."),
});

export type GetCryptoQuoteInput = z.infer<typeof getCryptoQuoteSchema>;

const DEFAULT_TTL_MIN = 15;

interface PerCryptoResult {
  ticker: string;
  quote: CryptoQuote | null;
  error: { code: string; message: string; recoverable: boolean } | null;
}

export interface GetCryptoQuoteResult {
  ok: boolean;
  source: string;
  results: PerCryptoResult[];
  warnings: string[];
}

export interface GetCryptoQuoteDeps {
  source?: CryptoQuoteSource;
  cache?: MarketDataCache;
}

function errorToShape(e: unknown): PerCryptoResult["error"] {
  if (e instanceof AdvisorError) {
    return { code: e.code, message: e.message, recoverable: e.recoverable };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "UNKNOWN", message: msg, recoverable: false };
}

export async function getCryptoQuote(
  input: GetCryptoQuoteInput,
  deps: GetCryptoQuoteDeps = {},
): Promise<GetCryptoQuoteResult> {
  await requireOutboundEnabled();
  const source = deps.source ?? new MercadoBitcoinSource();
  const cache = deps.cache ?? new MarketDataCache(getDb());

  const ttl = input.cache_ttl_minutes ?? DEFAULT_TTL_MIN;
  const results: PerCryptoResult[] = [];

  for (const ticker of input.tickers) {
    const row: PerCryptoResult = { ticker, quote: null, error: null };
    try {
      const cached =
        ttl > 0 ? cache.get<CryptoQuote>(ticker, "crypto_quote", ttl) : null;
      if (cached) {
        row.quote = cached.data;
      } else {
        const fresh = await source.getCryptoQuote(ticker);
        cache.put(ticker, "crypto_quote", fresh, source.name);
        row.quote = fresh;
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
