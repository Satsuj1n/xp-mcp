import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { MarketDataCache } from "../advisor/market-data/cache.js";
import {
  TickerNotFoundError,
  OutboundDisabledError,
} from "../advisor/errors.js";
import { saveProfile, advisorProfileSchema } from "../advisor/profile.js";
import { getCryptoQuote, DISCLAIMER } from "./get-crypto-quote.js";
import type {
  CryptoQuote,
  CryptoQuoteSource,
} from "../advisor/market-data/crypto-source.js";

class StubCryptoSource implements CryptoQuoteSource {
  readonly name = "mercadobitcoin";
  public calls = 0;
  constructor(
    private readonly behaviour: (ticker: string) => CryptoQuote | Error = (
      ticker,
    ) => ({
      ticker,
      price_brl: 350000,
      high_brl: 352000,
      low_brl: 348000,
      buy_brl: 349900,
      sell_brl: 350100,
      volume: 123.45,
      updated_at: "2026-05-24T00:00:00.000Z",
      source: "mercadobitcoin",
    }),
  ) {}
  async getCryptoQuote(ticker: string): Promise<CryptoQuote> {
    this.calls++;
    const v = this.behaviour(ticker);
    if (v instanceof Error) throw v;
    return v;
  }
}

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xp-mcp-getcq-"));
  process.env.XP_MCP_PROFILE_PATH = join(tempDir, "advisor-profile.json");
  db = new Database(":memory:");
  applySchema(db);
});

afterEach(() => {
  db.close();
  delete process.env.XP_MCP_PROFILE_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

async function enableOutbound() {
  await saveProfile(
    advisorProfileSchema.parse({
      risk_tolerance: 5,
      horizon_years: 10,
      objective: "balanced",
      outbound_enabled: true,
      accepted_disclaimer_at: new Date().toISOString(),
    }),
  );
}

test("happy path: returns crypto quote per ticker with disclaimer warning", async () => {
  await enableOutbound();
  const source = new StubCryptoSource();
  const cache = new MarketDataCache(db);
  const result = await getCryptoQuote({ tickers: ["BTC"] }, { source, cache });
  assert.equal(result.ok, true);
  assert.equal(result.source, "mercadobitcoin");
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].ticker, "BTC");
  assert.ok(result.results[0].quote);
  assert.equal(result.results[0].quote?.price_brl, 350000);
  assert.equal(result.results[0].error, null);
  assert.ok(
    result.warnings.includes(DISCLAIMER),
    "expected DISCLAIMER in warnings",
  );
});

test("cache hit: pre-seeded cache means source is NOT called", async () => {
  await enableOutbound();
  const source = new StubCryptoSource(() => {
    throw new Error("source should not be called on cache hit");
  });
  const cache = new MarketDataCache(db);
  const seeded: CryptoQuote = {
    ticker: "BTC",
    price_brl: 351000,
    high_brl: 352000,
    low_brl: 348000,
    buy_brl: 350900,
    sell_brl: 351100,
    volume: 99.9,
    updated_at: "2026-05-24T00:00:00.000Z",
    source: "mercadobitcoin",
  };
  cache.put("BTC", "crypto_quote", seeded, "mercadobitcoin");

  const result = await getCryptoQuote({ tickers: ["BTC"] }, { source, cache });
  assert.equal(source.calls, 0, "source must not be called on cache hit");
  assert.equal(result.results[0].quote?.price_brl, 351000);
  assert.equal(result.results[0].error, null);
});

test("throws OutboundDisabledError when outbound disabled", async () => {
  await saveProfile(
    advisorProfileSchema.parse({
      risk_tolerance: 5,
      horizon_years: 10,
      objective: "balanced",
    }),
  );
  const source = new StubCryptoSource();
  const cache = new MarketDataCache(db);
  await assert.rejects(
    getCryptoQuote({ tickers: ["BTC"] }, { source, cache }),
    (e: unknown) => e instanceof OutboundDisabledError,
  );
  assert.equal(source.calls, 0);
});

test("partial failure: one ticker errors, others succeed", async () => {
  await enableOutbound();
  const source = new StubCryptoSource((ticker) =>
    ticker === "FAKE"
      ? new TickerNotFoundError("FAKE")
      : {
          ticker,
          price_brl: 350000,
          high_brl: 352000,
          low_brl: 348000,
          buy_brl: 349900,
          sell_brl: 350100,
          volume: 123.45,
          updated_at: "2026-05-24T00:00:00.000Z",
          source: "mercadobitcoin",
        },
  );
  const cache = new MarketDataCache(db);
  const result = await getCryptoQuote(
    { tickers: ["BTC", "FAKE"] },
    { source, cache },
  );
  assert.equal(result.ok, true);
  const btc = result.results.find((r) => r.ticker === "BTC")!;
  const fake = result.results.find((r) => r.ticker === "FAKE")!;
  assert.ok(btc.quote, "BTC should have a quote");
  assert.equal(btc.error, null);
  assert.equal(fake.quote, null);
  assert.equal(fake.error?.code, "TICKER_NOT_FOUND");
});

test("cache_ttl_minutes=0 forces a fresh fetch even with a cached row", async () => {
  await enableOutbound();
  const source = new StubCryptoSource();
  const cache = new MarketDataCache(db);
  const seeded: CryptoQuote = {
    ticker: "BTC",
    price_brl: 351000,
    high_brl: 352000,
    low_brl: 348000,
    buy_brl: 350900,
    sell_brl: 351100,
    volume: 99.9,
    updated_at: "2026-05-24T00:00:00.000Z",
    source: "mercadobitcoin",
  };
  cache.put("BTC", "crypto_quote", seeded, "mercadobitcoin");

  const result = await getCryptoQuote(
    { tickers: ["BTC"], cache_ttl_minutes: 0 },
    { source, cache },
  );
  assert.equal(source.calls, 1, "ttl=0 must bypass cache and hit the source");
  assert.equal(result.results[0].quote?.price_brl, 350000);
});
