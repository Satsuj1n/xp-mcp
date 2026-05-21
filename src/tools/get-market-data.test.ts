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
import { getMarketData } from "./get-market-data.js";
import type {
  Fundamentals,
  MarketDataSource,
  Quote,
  UniverseClass,
  UniverseListItem,
} from "../advisor/market-data/source.js";

class StubSource implements MarketDataSource {
  readonly name = "stub";
  public quoteCalls = 0;
  public fundamentalsCalls = 0;
  constructor(
    private readonly behaviour: {
      quote?: (ticker: string) => Quote | Error;
      fundamentals?: (ticker: string) => Fundamentals | Error;
    } = {},
  ) {}
  async getQuote(ticker: string): Promise<Quote> {
    this.quoteCalls++;
    const v = this.behaviour.quote?.(ticker) ?? {
      ticker,
      price_brl: 1,
      change_pct: 0,
      volume: 1,
      market_cap_brl: 1,
      updated_at: "2026-05-20T00:00:00.000Z",
    };
    if (v instanceof Error) throw v;
    return v;
  }
  async getFundamentals(ticker: string): Promise<Fundamentals> {
    this.fundamentalsCalls++;
    const v = this.behaviour.fundamentals?.(ticker) ?? {
      ticker,
      dividend_yield_pct: 0,
      pl_ratio: 0,
      pvp_ratio: 0,
      roe_pct: 0,
      vacancy_pct: null,
      updated_at: "2026-05-20T00:00:00.000Z",
    };
    if (v instanceof Error) throw v;
    return v;
  }
  async listUniverse(_c: UniverseClass): Promise<UniverseListItem[]> {
    return [];
  }
}

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xp-mcp-getmd-"));
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

test("throws OutboundDisabledError when outbound disabled", async () => {
  await saveProfile(
    advisorProfileSchema.parse({
      risk_tolerance: 5,
      horizon_years: 10,
      objective: "balanced",
    }),
  );
  const source = new StubSource();
  const cache = new MarketDataCache(db);
  await assert.rejects(
    getMarketData(
      { tickers: ["BBAS3"], include: ["quote"] },
      { source, cache },
    ),
    (e: unknown) => e instanceof OutboundDisabledError,
  );
  assert.equal(source.quoteCalls, 0);
});

test("happy path: returns quote per ticker with disclaimer warning", async () => {
  await enableOutbound();
  const source = new StubSource();
  const cache = new MarketDataCache(db);
  const result = await getMarketData(
    { tickers: ["BBAS3", "MXRF11"], include: ["quote"] },
    { source, cache },
  );
  assert.equal(result.ok, true);
  assert.equal(result.source, "stub");
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].ticker, "BBAS3");
  assert.ok(result.results[0].quote);
  assert.equal(result.results[0].fundamentals, null);
  assert.equal(result.results[0].error, null);
  assert.ok(
    result.warnings.some((w) => w.includes("disclaimer")),
    "expected disclaimer in warnings",
  );
});

test("cache hit skips source call", async () => {
  await enableOutbound();
  const source = new StubSource();
  const cache = new MarketDataCache(db);
  await getMarketData(
    { tickers: ["BBAS3"], include: ["quote"] },
    { source, cache },
  );
  assert.equal(source.quoteCalls, 1);
  await getMarketData(
    { tickers: ["BBAS3"], include: ["quote"] },
    { source, cache },
  );
  assert.equal(source.quoteCalls, 1, "second call should be served from cache");
});

test("cache_ttl_minutes=0 forces refresh", async () => {
  await enableOutbound();
  const source = new StubSource();
  const cache = new MarketDataCache(db);
  await getMarketData(
    { tickers: ["BBAS3"], include: ["quote"] },
    { source, cache },
  );
  await getMarketData(
    { tickers: ["BBAS3"], include: ["quote"], cache_ttl_minutes: 0 },
    { source, cache },
  );
  assert.equal(source.quoteCalls, 2);
});

test("partial failure: one ticker errors, others succeed", async () => {
  await enableOutbound();
  const source = new StubSource({
    quote: (t) =>
      t === "BAD1"
        ? new TickerNotFoundError("BAD1")
        : ({
            ticker: t,
            price_brl: 1,
            change_pct: 0,
            volume: 1,
            market_cap_brl: 1,
            updated_at: "2026-05-20T00:00:00.000Z",
          } as Quote),
  });
  const cache = new MarketDataCache(db);
  const result = await getMarketData(
    { tickers: ["BBAS3", "BAD1"], include: ["quote"] },
    { source, cache },
  );
  assert.equal(result.ok, true);
  const bad = result.results.find((r) => r.ticker === "BAD1")!;
  assert.equal(bad.quote, null);
  assert.equal(bad.error?.code, "TICKER_NOT_FOUND");
});

test("include=['quote','fundamentals'] fetches both", async () => {
  await enableOutbound();
  const source = new StubSource();
  const cache = new MarketDataCache(db);
  const result = await getMarketData(
    { tickers: ["BBAS3"], include: ["quote", "fundamentals"] },
    { source, cache },
  );
  assert.ok(result.results[0].quote);
  assert.ok(result.results[0].fundamentals);
  assert.equal(source.quoteCalls, 1);
  assert.equal(source.fundamentalsCalls, 1);
});
