import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  MercadoBitcoinSource,
  FoxbitSource,
  BinanceSource,
  MbUsdBrlRate,
  MultiSourceCryptoQuoteSource,
} from "./crypto-source.js";
import type {
  CryptoQuote,
  CryptoQuoteSource,
  UsdBrlRateProvider,
} from "./crypto-source.js";
import { TickerNotFoundError, UpstreamTimeoutError } from "../errors.js";

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// Spec § 3 sample MB ticker envelope.
function sampleEnvelope() {
  return {
    ticker: {
      high: "352000.00000000",
      low: "348000.00000000",
      vol: "123.45678901",
      last: "350000.00000000",
      buy: "349900.00000000",
      sell: "350100.00000000",
      open: "349000.00000000",
      date: 1716580000,
    },
  };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("getCryptoQuote: happy path — parses MB response into CryptoQuote", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(sampleEnvelope());
  }) as FetchFn;
  const source = new MercadoBitcoinSource();
  const quote = await source.getCryptoQuote("BTC");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://www.mercadobitcoin.net/api/BTC/ticker/");
  assert.equal(quote.ticker, "BTC");
  assert.equal(quote.price_brl, 350000);
  assert.equal(quote.high_brl, 352000);
  assert.equal(quote.low_brl, 348000);
  assert.equal(quote.buy_brl, 349900);
  assert.equal(quote.sell_brl, 350100);
  assert.equal(quote.volume, 123.45678901);
  assert.equal(quote.updated_at, new Date(1716580000 * 1000).toISOString());
  assert.equal(quote.source, "mercadobitcoin");
});

test("getCryptoQuote: missing ticker object → TickerNotFoundError", async () => {
  globalThis.fetch = (async () => jsonResponse({})) as FetchFn;
  const source = new MercadoBitcoinSource();
  await assert.rejects(
    source.getCryptoQuote("BTC"),
    (e: unknown) => e instanceof TickerNotFoundError,
  );
});

test('getCryptoQuote: last="0" / non-positive → TickerNotFoundError', async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      ticker: {
        high: "0",
        low: "0",
        vol: "0",
        last: "0",
        buy: "0",
        sell: "0",
        open: "0",
        date: 1716580000,
      },
    })) as FetchFn;
  const source = new MercadoBitcoinSource();
  await assert.rejects(
    source.getCryptoQuote("BTC"),
    (e: unknown) => e instanceof TickerNotFoundError,
  );
});

test("getCryptoQuote: string prices parsed to numbers", async () => {
  globalThis.fetch = (async () => jsonResponse(sampleEnvelope())) as FetchFn;
  const source = new MercadoBitcoinSource();
  const quote = await source.getCryptoQuote("BTC");
  assert.equal(typeof quote.price_brl, "number");
  assert.equal(quote.price_brl, 350000);
});

test("getCryptoQuote: Unix date → ISO", async () => {
  globalThis.fetch = (async () => jsonResponse(sampleEnvelope())) as FetchFn;
  const source = new MercadoBitcoinSource();
  const quote = await source.getCryptoQuote("BTC");
  assert.equal(quote.updated_at, new Date(1716580000 * 1000).toISOString());
});

test('getCryptoQuote: source is "mercadobitcoin" and ticker uppercased', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(sampleEnvelope());
  }) as FetchFn;
  const source = new MercadoBitcoinSource();
  const quote = await source.getCryptoQuote("btc");
  assert.equal(quote.source, "mercadobitcoin");
  assert.equal(quote.ticker, "BTC");
  assert.equal(calls[0], "https://www.mercadobitcoin.net/api/BTC/ticker/");
});

// ---------------------------------------------------------------------------
// FoxbitSource
// ---------------------------------------------------------------------------

// Spec § 3.2 nested Foxbit response.
function sampleFoxbit() {
  return {
    last_trade: { price: "350000.50", date: "2026-05-25T12:00:00.000Z" },
    rolling_24h: { high: "352000.00", low: "348000.00", volume: "123.45" },
    best: { bid: { price: "349900.00" }, ask: { price: "350100.00" } },
  };
}

test("FoxbitSource: happy path — nested response → flat CryptoQuote", async () => {
  globalThis.fetch = (async () => jsonResponse(sampleFoxbit())) as FetchFn;
  const source = new FoxbitSource();
  const quote = await source.getCryptoQuote("BTC");
  assert.equal(quote.ticker, "BTC");
  assert.equal(quote.price_brl, 350000.5);
  assert.equal(quote.high_brl, 352000);
  assert.equal(quote.low_brl, 348000);
  assert.equal(quote.buy_brl, 349900);
  assert.equal(quote.sell_brl, 350100);
  assert.equal(quote.volume, 123.45);
  assert.equal(quote.updated_at, "2026-05-25T12:00:00.000Z");
  assert.equal(quote.source, "foxbit");
  // BRL-native source leaves USD fields undefined.
  assert.equal(quote.price_usd, undefined);
  assert.equal(quote.fx_rate_brl_per_usd, undefined);
});

test("FoxbitSource: lowercase <coin>brl market symbol in URL", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(sampleFoxbit());
  }) as FetchFn;
  const source = new FoxbitSource();
  await source.getCryptoQuote("BTC");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0],
    "https://api.foxbit.com.br/rest/v3/markets/btcbrl/ticker/24hr",
  );
});

test('FoxbitSource: source is "foxbit" and ticker uppercased', async () => {
  globalThis.fetch = (async () => jsonResponse(sampleFoxbit())) as FetchFn;
  const source = new FoxbitSource();
  const quote = await source.getCryptoQuote("btc");
  assert.equal(quote.source, "foxbit");
  assert.equal(quote.ticker, "BTC");
});

test("FoxbitSource: missing last_trade.date → falls back to now (ISO)", async () => {
  const body = sampleFoxbit();
  delete (body.last_trade as { date?: string }).date;
  globalThis.fetch = (async () => jsonResponse(body)) as FetchFn;
  const before = Date.now();
  const source = new FoxbitSource();
  const quote = await source.getCryptoQuote("BTC");
  const parsed = Date.parse(quote.updated_at);
  assert.ok(Number.isFinite(parsed));
  assert.ok(parsed >= before);
});

test("FoxbitSource: unknown market (404) → TickerNotFoundError", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ error: "not found" }, 404)) as FetchFn;
  const source = new FoxbitSource({ max_retries: 0 });
  await assert.rejects(
    source.getCryptoQuote("NOPE"),
    (e: unknown) => e instanceof TickerNotFoundError,
  );
});

test("FoxbitSource: missing nested field → TickerNotFoundError", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      rolling_24h: { high: "1", low: "1", volume: "1" },
    })) as FetchFn;
  const source = new FoxbitSource();
  await assert.rejects(
    source.getCryptoQuote("BTC"),
    (e: unknown) => e instanceof TickerNotFoundError,
  );
});

test("FoxbitSource: non-positive price → TickerNotFoundError", async () => {
  const body = sampleFoxbit();
  body.last_trade.price = "0";
  globalThis.fetch = (async () => jsonResponse(body)) as FetchFn;
  const source = new FoxbitSource();
  await assert.rejects(
    source.getCryptoQuote("BTC"),
    (e: unknown) => e instanceof TickerNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// MbUsdBrlRate
// ---------------------------------------------------------------------------

test("MbUsdBrlRate: returns parseFloat(ticker.last) from MB USDT endpoint", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse({ ticker: { last: "5.01" } });
  }) as FetchFn;
  const provider = new MbUsdBrlRate();
  const rate = await provider.getUsdBrlRate();
  assert.equal(rate, 5.01);
  assert.equal(calls[0], "https://www.mercadobitcoin.net/api/USDT/ticker/");
});

test("MbUsdBrlRate: non-positive rate (0) → throws", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ ticker: { last: "0" } })) as FetchFn;
  const provider = new MbUsdBrlRate();
  await assert.rejects(provider.getUsdBrlRate());
});

test("MbUsdBrlRate: missing ticker → throws", async () => {
  globalThis.fetch = (async () => jsonResponse({})) as FetchFn;
  const provider = new MbUsdBrlRate();
  await assert.rejects(provider.getUsdBrlRate());
});

// ---------------------------------------------------------------------------
// BinanceSource
// ---------------------------------------------------------------------------

// Spec § 3.1 sample Binance 24hr ticker (all monetary fields strings).
function sampleBinance() {
  return {
    lastPrice: "77299.54",
    bidPrice: "77299.53",
    askPrice: "77299.54",
    highPrice: "77699.97",
    lowPrice: "76108.00",
    volume: "8693.73",
    closeTime: 1779713306002,
  };
}

function stubRate(rate: number): UsdBrlRateProvider {
  return { getUsdBrlRate: async () => rate };
}

test("BinanceSource: happy path — USDT→BRL using stubbed rate", async () => {
  const rate = 5.0;
  globalThis.fetch = (async () => jsonResponse(sampleBinance())) as FetchFn;
  const source = new BinanceSource({}, stubRate(rate));
  const quote = await source.getCryptoQuote("BTC");
  assert.equal(quote.ticker, "BTC");
  assert.equal(quote.price_usd, 77299.54);
  assert.equal(quote.fx_rate_brl_per_usd, rate);
  assert.equal(quote.price_brl, 77299.54 * rate);
  assert.equal(quote.high_brl, 77699.97 * rate);
  assert.equal(quote.low_brl, 76108.0 * rate);
  assert.equal(quote.buy_brl, 77299.53 * rate);
  assert.equal(quote.sell_brl, 77299.54 * rate);
  // volume stays in coin units (NOT converted).
  assert.equal(quote.volume, 8693.73);
  assert.equal(quote.source, "binance");
});

test("BinanceSource: closeTime (ms) → ISO date", async () => {
  globalThis.fetch = (async () => jsonResponse(sampleBinance())) as FetchFn;
  const source = new BinanceSource({}, stubRate(5));
  const quote = await source.getCryptoQuote("BTC");
  assert.equal(quote.updated_at, new Date(1779713306002).toISOString());
});

test("BinanceSource: symbol uppercased + USDT suffix in URL", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(sampleBinance());
  }) as FetchFn;
  const source = new BinanceSource({}, stubRate(5));
  const quote = await source.getCryptoQuote("btc");
  assert.equal(quote.ticker, "BTC");
  assert.equal(
    calls[0],
    "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT",
  );
});

test("BinanceSource: invalid symbol (HTTP 400) → TickerNotFoundError", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({ code: -1121, msg: "Invalid symbol." }, 400)) as FetchFn;
  const source = new BinanceSource({ max_retries: 0 }, stubRate(5));
  await assert.rejects(
    source.getCryptoQuote("NOPE"),
    (e: unknown) => e instanceof TickerNotFoundError,
  );
});

test("BinanceSource: rate-provider failure propagates", async () => {
  globalThis.fetch = (async () => jsonResponse(sampleBinance())) as FetchFn;
  const failingProvider: UsdBrlRateProvider = {
    getUsdBrlRate: async () => {
      throw new UpstreamTimeoutError("rate fetch failed");
    },
  };
  const source = new BinanceSource({}, failingProvider);
  await assert.rejects(
    source.getCryptoQuote("BTC"),
    (e: unknown) => e instanceof UpstreamTimeoutError,
  );
});

// ---------------------------------------------------------------------------
// MultiSourceCryptoQuoteSource
// ---------------------------------------------------------------------------

function fakeQuote(source: string): CryptoQuote {
  return {
    ticker: "BTC",
    price_brl: 1,
    high_brl: 1,
    low_brl: 1,
    buy_brl: 1,
    sell_brl: 1,
    volume: 1,
    updated_at: "2026-05-25T00:00:00.000Z",
    source,
  };
}

function fakeSource(
  name: string,
  impl: () => Promise<CryptoQuote>,
): CryptoQuoteSource & { called: boolean } {
  const s = {
    name,
    called: false,
    async getCryptoQuote() {
      s.called = true;
      return impl();
    },
  };
  return s;
}

test('MultiSourceCryptoQuoteSource: name is "multi"', () => {
  const multi = new MultiSourceCryptoQuoteSource([]);
  assert.equal(multi.name, "multi");
});

test("MultiSourceCryptoQuoteSource: first source wins, others not called", async () => {
  const first = fakeSource("a", async () => fakeQuote("a"));
  const second = fakeSource("b", async () => fakeQuote("b"));
  const multi = new MultiSourceCryptoQuoteSource([first, second]);
  const quote = await multi.getCryptoQuote("BTC");
  assert.equal(quote.source, "a");
  assert.equal(first.called, true);
  assert.equal(second.called, false);
});

test("MultiSourceCryptoQuoteSource: TickerNotFoundError falls through to next", async () => {
  const first = fakeSource("a", async () => {
    throw new TickerNotFoundError("BTC");
  });
  const second = fakeSource("b", async () => fakeQuote("b"));
  const multi = new MultiSourceCryptoQuoteSource([first, second]);
  const quote = await multi.getCryptoQuote("BTC");
  assert.equal(quote.source, "b");
  assert.equal(first.called, true);
  assert.equal(second.called, true);
});

test("MultiSourceCryptoQuoteSource: recoverable error falls through to next", async () => {
  const first = fakeSource("a", async () => {
    throw new UpstreamTimeoutError("timeout");
  });
  const second = fakeSource("b", async () => fakeQuote("b"));
  const multi = new MultiSourceCryptoQuoteSource([first, second]);
  const quote = await multi.getCryptoQuote("BTC");
  assert.equal(quote.source, "b");
});

test("MultiSourceCryptoQuoteSource: all fail → throws last error", async () => {
  const lastErr = new TickerNotFoundError("BTC");
  const first = fakeSource("a", async () => {
    throw new UpstreamTimeoutError("timeout");
  });
  const second = fakeSource("b", async () => {
    throw lastErr;
  });
  const multi = new MultiSourceCryptoQuoteSource([first, second]);
  await assert.rejects(
    multi.getCryptoQuote("BTC"),
    (e: unknown) => e === lastErr,
  );
});

test("MultiSourceCryptoQuoteSource: non-recoverable non-TickerNotFound propagates immediately", async () => {
  const fatal = new Error("boom");
  const first = fakeSource("a", async () => {
    throw fatal;
  });
  const second = fakeSource("b", async () => fakeQuote("b"));
  const multi = new MultiSourceCryptoQuoteSource([first, second]);
  await assert.rejects(
    multi.getCryptoQuote("BTC"),
    (e: unknown) => e === fatal,
  );
  assert.equal(second.called, false);
});
