import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { MercadoBitcoinSource } from "./crypto-source.js";
import { TickerNotFoundError } from "../errors.js";

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
