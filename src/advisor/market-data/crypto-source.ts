import { TickerNotFoundError } from "../errors.js";
import { fetchWithRetry } from "./fetch.js";

export interface CryptoQuote {
  ticker: string;
  price_brl: number;
  high_brl: number;
  low_brl: number;
  buy_brl: number;
  sell_brl: number;
  volume: number;
  updated_at: string;
  source: string;
}

export interface CryptoQuoteSource {
  readonly name: string;
  getCryptoQuote(ticker: string): Promise<CryptoQuote>;
}

interface MbTicker {
  high: string;
  low: string;
  vol: string;
  last: string;
  buy: string;
  sell: string;
  date: number;
}

interface MbEnvelope {
  ticker?: MbTicker;
}

export interface MercadoBitcoinOptions {
  timeout_ms?: number;
  max_retries?: number;
}

const BASE = "https://www.mercadobitcoin.net/api";

export class MercadoBitcoinSource implements CryptoQuoteSource {
  readonly name = "mercadobitcoin";

  constructor(private readonly opts: MercadoBitcoinOptions = {}) {}

  async getCryptoQuote(ticker: string): Promise<CryptoQuote> {
    const sym = ticker.toUpperCase();
    const env = (await fetchWithRetry(
      `${BASE}/${encodeURIComponent(sym)}/ticker/`,
      { timeout_ms: this.opts.timeout_ms, max_retries: this.opts.max_retries },
    )) as MbEnvelope;

    const t = env.ticker;
    // Guard: missing object, or `last` not a positive number → not found.
    if (!t || t.last == null || !(parseFloat(t.last) > 0)) {
      throw new TickerNotFoundError(sym);
    }

    return {
      ticker: sym,
      price_brl: parseFloat(t.last),
      high_brl: parseFloat(t.high),
      low_brl: parseFloat(t.low),
      buy_brl: parseFloat(t.buy),
      sell_brl: parseFloat(t.sell),
      volume: parseFloat(t.vol),
      updated_at: new Date(t.date * 1000).toISOString(),
      source: this.name,
    };
  }
}
