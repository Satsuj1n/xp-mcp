import { z } from "zod";
import type { Database } from "better-sqlite3";
import { AdvisorError } from "../advisor/errors.js";
import { requireOutboundEnabled } from "../advisor/profile.js";
import {
  MercadoBitcoinSource,
  FoxbitSource,
  BinanceSource,
  MultiSourceCryptoQuoteSource,
} from "../advisor/market-data/crypto-source.js";
import type { CryptoQuoteSource } from "../advisor/market-data/crypto-source.js";
import {
  upsertCryptoPosition,
  deleteCryptoPosition,
} from "../storage/positions-repo.js";
import { getDb } from "../storage/db.js";

export const DISCLAIMER =
  "[disclaimer] Análise educacional baseada em dados públicos. Não constitui recomendação de investimento. Decisões financeiras são de sua responsabilidade.";

export const setCryptoPositionSchema = z.object({
  ticker: z
    .string()
    .regex(/^[A-Z0-9]{2,10}$/)
    .describe("Crypto symbol, uppercase (e.g. 'BTC')."),
  quantity: z
    .number()
    .nonnegative()
    .describe("Amount held (fractional ok). 0 removes the holding."),
});

export type SetCryptoPositionInput = z.infer<typeof setCryptoPositionSchema>;

interface StoredCryptoPosition {
  ticker: string;
  name: string;
  quantity: number;
  current_price_cents: number;
  market_value_cents: number;
}

export interface SetCryptoPositionResult {
  ok: boolean;
  removed: boolean;
  ticker: string;
  position?: StoredCryptoPosition;
  source?: string;
  error?: { code: string; message: string; recoverable: boolean };
  warnings: string[];
}

export interface SetCryptoPositionDeps {
  source?: CryptoQuoteSource;
  db?: Database;
}

function errorToShape(e: unknown): SetCryptoPositionResult["error"] {
  if (e instanceof AdvisorError) {
    return { code: e.code, message: e.message, recoverable: e.recoverable };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { code: "UNKNOWN", message: msg, recoverable: false };
}

export async function setCryptoPosition(
  input: SetCryptoPositionInput,
  deps: SetCryptoPositionDeps = {},
): Promise<SetCryptoPositionResult> {
  // Outbound gate first: even a removal stays behind it for consistency, and a
  // non-removal needs HTTP egress to value the holding.
  await requireOutboundEnabled();

  const db = deps.db ?? getDb();
  const { ticker, quantity } = input;

  // quantity:0 removes the holding (idempotent — no-op if absent). No quote.
  if (quantity === 0) {
    deleteCryptoPosition(db, ticker);
    return { ok: true, removed: true, ticker, warnings: [DISCLAIMER] };
  }

  // Fallback chain mirrors get_crypto_quote (BRL-native first, Binance last).
  const source =
    deps.source ??
    new MultiSourceCryptoQuoteSource([
      new MercadoBitcoinSource(),
      new FoxbitSource(),
      new BinanceSource(),
    ]);

  let quote;
  try {
    quote = await source.getCryptoQuote(ticker);
  } catch (e) {
    // TickerNotFoundError (or any AdvisorError) → per-tool error, no write.
    return {
      ok: false,
      removed: false,
      ticker,
      error: errorToShape(e),
      warnings: [DISCLAIMER],
    };
  }

  const current_price_cents = Math.round(quote.price_brl * 100);
  const market_value_cents = Math.round(quantity * quote.price_brl * 100);

  upsertCryptoPosition(db, {
    ticker,
    name: ticker,
    quantity,
    current_price_cents,
    market_value_cents,
  });

  return {
    ok: true,
    removed: false,
    ticker,
    position: {
      ticker,
      name: ticker,
      quantity,
      current_price_cents,
      market_value_cents,
    },
    source: quote.source,
    warnings: [DISCLAIMER],
  };
}
