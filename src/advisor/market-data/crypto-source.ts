import { AdvisorError, TickerNotFoundError } from "../errors.js";
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
  /** Set only by USDT-native sources (Binance); BRL-native sources leave undefined. */
  price_usd?: number;
  /** The USDT/BRL rate used for conversion; set only by USDT-native sources. */
  fx_rate_brl_per_usd?: number;
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

// ---------------------------------------------------------------------------
// USDT/BRL rate provider (for Binance USD→BRL conversion)
// ---------------------------------------------------------------------------

export interface UsdBrlRateProvider {
  /** Returns BRL per USD (via USDT proxy), e.g. 5.01. */
  getUsdBrlRate(): Promise<number>;
}

export interface RateProviderOptions {
  timeout_ms?: number;
  max_retries?: number;
}

/**
 * Default rate provider: reuses the already-integrated Mercado Bitcoin
 * /USDT/ticker/ endpoint. USDT is treated as a USD proxy (stablecoin).
 */
export class MbUsdBrlRate implements UsdBrlRateProvider {
  constructor(private readonly opts: RateProviderOptions = {}) {}

  async getUsdBrlRate(): Promise<number> {
    const env = (await fetchWithRetry(`${BASE}/USDT/ticker/`, {
      timeout_ms: this.opts.timeout_ms,
      max_retries: this.opts.max_retries,
    })) as MbEnvelope;

    const last = env.ticker?.last;
    const rate = last == null ? NaN : parseFloat(last);
    // Guard: a rate of 0 (or non-positive / NaN) is unusable for conversion.
    if (!(rate > 0)) {
      throw new Error("Unusable USDT/BRL rate from Mercado Bitcoin");
    }
    return rate;
  }
}

// ---------------------------------------------------------------------------
// FoxbitSource (BRL-native)
// ---------------------------------------------------------------------------

interface FoxbitTicker {
  last_trade?: { price?: string; date?: string };
  rolling_24h?: { high?: string; low?: string; volume?: string };
  best?: { bid?: { price?: string }; ask?: { price?: string } };
}

export interface FoxbitOptions {
  timeout_ms?: number;
  max_retries?: number;
}

const FOXBIT_BASE = "https://api.foxbit.com.br/rest/v3/markets";

export class FoxbitSource implements CryptoQuoteSource {
  readonly name = "foxbit";

  constructor(private readonly opts: FoxbitOptions = {}) {}

  async getCryptoQuote(ticker: string): Promise<CryptoQuote> {
    const sym = ticker.toUpperCase();
    const market = `${ticker.toLowerCase()}brl`;

    let raw: FoxbitTicker;
    try {
      raw = (await fetchWithRetry(
        `${FOXBIT_BASE}/${encodeURIComponent(market)}/ticker/24hr`,
        {
          timeout_ms: this.opts.timeout_ms,
          max_retries: this.opts.max_retries,
        },
      )) as FoxbitTicker;
    } catch (err: unknown) {
      // 404 / unknown market surfaces as a generic HTTP error from fetchWithRetry.
      if (isHttpClientError(err)) throw new TickerNotFoundError(sym);
      throw err;
    }

    const price = parseFloat(raw.last_trade?.price ?? "");
    const high = parseFloat(raw.rolling_24h?.high ?? "");
    const low = parseFloat(raw.rolling_24h?.low ?? "");
    const buy = parseFloat(raw.best?.bid?.price ?? "");
    const sell = parseFloat(raw.best?.ask?.price ?? "");
    const volume = parseFloat(raw.rolling_24h?.volume ?? "");

    // Guard: missing/garbage nested fields or non-positive price → not found.
    if (!(price > 0)) {
      throw new TickerNotFoundError(sym);
    }

    const date = raw.last_trade?.date;
    const updated_at = date ?? new Date().toISOString();

    return {
      ticker: sym,
      price_brl: price,
      high_brl: high,
      low_brl: low,
      buy_brl: buy,
      sell_brl: sell,
      volume,
      updated_at,
      source: this.name,
    };
  }
}

// ---------------------------------------------------------------------------
// BinanceSource (USDT-native → converts to BRL)
// ---------------------------------------------------------------------------

interface BinanceTicker {
  lastPrice?: string;
  bidPrice?: string;
  askPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  volume?: string;
  closeTime?: number;
}

export interface BinanceOptions {
  timeout_ms?: number;
  max_retries?: number;
}

const BINANCE_BASE = "https://api.binance.com/api/v3/ticker/24hr";

export class BinanceSource implements CryptoQuoteSource {
  readonly name = "binance";

  constructor(
    private readonly opts: BinanceOptions = {},
    private readonly rateProvider: UsdBrlRateProvider = new MbUsdBrlRate(),
  ) {}

  async getCryptoQuote(ticker: string): Promise<CryptoQuote> {
    const sym = ticker.toUpperCase();

    let raw: BinanceTicker;
    try {
      raw = (await fetchWithRetry(
        `${BINANCE_BASE}?symbol=${encodeURIComponent(`${sym}USDT`)}`,
        {
          timeout_ms: this.opts.timeout_ms,
          max_retries: this.opts.max_retries,
        },
      )) as BinanceTicker;
    } catch (err: unknown) {
      // Invalid symbol → HTTP 400; map any 4xx to TickerNotFoundError.
      if (isHttpClientError(err)) throw new TickerNotFoundError(sym);
      throw err;
    }

    const priceUsd = parseFloat(raw.lastPrice ?? "");
    if (!(priceUsd > 0)) {
      throw new TickerNotFoundError(sym);
    }

    // Rate-provider failure (recoverable) propagates by design.
    const rate = await this.rateProvider.getUsdBrlRate();

    return {
      ticker: sym,
      price_brl: priceUsd * rate,
      high_brl: parseFloat(raw.highPrice ?? "") * rate,
      low_brl: parseFloat(raw.lowPrice ?? "") * rate,
      buy_brl: parseFloat(raw.bidPrice ?? "") * rate,
      sell_brl: parseFloat(raw.askPrice ?? "") * rate,
      // volume stays in coin (base-asset) units — NOT converted.
      volume: parseFloat(raw.volume ?? ""),
      // closeTime is already Unix milliseconds.
      updated_at: new Date(raw.closeTime ?? Date.now()).toISOString(),
      source: this.name,
      price_usd: priceUsd,
      fx_rate_brl_per_usd: rate,
    };
  }
}

// ---------------------------------------------------------------------------
// MultiSourceCryptoQuoteSource (Chain-of-Responsibility / Composite)
// ---------------------------------------------------------------------------

export class MultiSourceCryptoQuoteSource implements CryptoQuoteSource {
  readonly name = "multi";

  constructor(private readonly sources: CryptoQuoteSource[]) {}

  async getCryptoQuote(ticker: string): Promise<CryptoQuote> {
    let lastError: unknown;
    for (const source of this.sources) {
      try {
        return await source.getCryptoQuote(ticker);
      } catch (err: unknown) {
        if (!isFallthroughError(err)) {
          // Non-recoverable, non-not-found error: fail fast.
          throw err;
        }
        lastError = err;
      }
    }
    throw lastError ?? new TickerNotFoundError(ticker.toUpperCase());
  }
}

/**
 * Whether the multi-source chain should fall through to the next source:
 * a TickerNotFoundError, or any recoverable AdvisorError (timeout / 429).
 */
function isFallthroughError(err: unknown): boolean {
  if (err instanceof TickerNotFoundError) return true;
  return err instanceof AdvisorError && err.recoverable === true;
}

/**
 * fetchWithRetry signals non-2xx (non-429) as `Error("HTTP <status> for <url>")`.
 * Detects a 4xx client error so callers can map it to TickerNotFoundError.
 */
function isHttpClientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = /^HTTP (\d{3}) for /.exec(err.message);
  if (!m) return false;
  const status = Number(m[1]);
  return status >= 400 && status < 500;
}
