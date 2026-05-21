import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { MarketDataCache } from "../advisor/market-data/cache.js";
import { OutboundDisabledError } from "../advisor/errors.js";
import { saveProfile, advisorProfileSchema } from "../advisor/profile.js";
import { screenAssets } from "./screen-assets.js";
import type {
  Fundamentals,
  MarketDataSource,
  Quote,
  UniverseClass,
  UniverseListItem,
} from "../advisor/market-data/source.js";

interface FakeData {
  universe: UniverseListItem[];
  quotes: Record<string, Quote>;
  fundamentals: Record<string, Fundamentals>;
}

class FakeSource implements MarketDataSource {
  readonly name = "fake";
  constructor(private readonly data: FakeData) {}
  async getQuote(t: string): Promise<Quote> {
    const q = this.data.quotes[t];
    if (!q) throw new Error(`no quote ${t}`);
    return q;
  }
  async getFundamentals(t: string): Promise<Fundamentals> {
    const f = this.data.fundamentals[t];
    if (!f) throw new Error(`no fundamentals ${t}`);
    return f;
  }
  async listUniverse(_c: UniverseClass): Promise<UniverseListItem[]> {
    return this.data.universe;
  }
}

function q(ticker: string, marketCap = 1_000_000_000): Quote {
  return {
    ticker,
    price_brl: 10,
    change_pct: 0,
    volume: 100,
    market_cap_brl: marketCap,
    updated_at: "2026-05-20T00:00:00.000Z",
  };
}

function f(ticker: string, fields: Partial<Fundamentals> = {}): Fundamentals {
  return {
    ticker,
    dividend_yield_pct: null,
    pl_ratio: null,
    pvp_ratio: null,
    roe_pct: null,
    vacancy_pct: null,
    updated_at: "2026-05-20T00:00:00.000Z",
    ...fields,
  };
}

let tempDir: string;
let db: Database.Database;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xp-mcp-screen-"));
  process.env.XP_MCP_PROFILE_PATH = join(tempDir, "advisor-profile.json");
  db = new Database(":memory:");
  applySchema(db);
});

afterEach(() => {
  db.close();
  delete process.env.XP_MCP_PROFILE_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

async function enableOutbound(
  extra: Partial<{
    excluded_tickers: string[];
    excluded_classes: string[];
  }> = {},
) {
  await saveProfile(
    advisorProfileSchema.parse({
      risk_tolerance: 5,
      horizon_years: 10,
      objective: "balanced",
      outbound_enabled: true,
      accepted_disclaimer_at: new Date().toISOString(),
      ...extra,
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
  const source = new FakeSource({ universe: [], quotes: {}, fundamentals: {} });
  const cache = new MarketDataCache(db);
  await assert.rejects(
    screenAssets(
      {
        asset_class: "FII",
        criteria: {
          sort_by: "dividend_yield",
          order: "desc",
          filters: {},
          limit: 5,
        },
        exclude_tickers: [],
      },
      { source, cache },
    ),
    (e: unknown) => e instanceof OutboundDisabledError,
  );
});

test("happy path: ranks FIIs by DY desc, limits to 2, includes disclaimer", async () => {
  await enableOutbound();
  const data: FakeData = {
    universe: [
      { ticker: "MXRF11", name: "MAXI RENDA", asset_class: "FII" },
      { ticker: "HGLG11", name: "CSHG LOGISTICA", asset_class: "FII" },
      { ticker: "KNRI11", name: "KINEA", asset_class: "FII" },
    ],
    quotes: { MXRF11: q("MXRF11"), HGLG11: q("HGLG11"), KNRI11: q("KNRI11") },
    fundamentals: {
      MXRF11: f("MXRF11", { dividend_yield_pct: 11 }),
      HGLG11: f("HGLG11", { dividend_yield_pct: 8 }),
      KNRI11: f("KNRI11", { dividend_yield_pct: 9 }),
    },
  };
  const source = new FakeSource(data);
  const cache = new MarketDataCache(db);
  const result = await screenAssets(
    {
      asset_class: "FII",
      criteria: {
        sort_by: "dividend_yield",
        order: "desc",
        filters: {},
        limit: 2,
      },
      exclude_tickers: [],
    },
    { source, cache },
  );
  assert.equal(result.ok, true);
  assert.equal(result.asset_class, "FII");
  assert.equal(result.universe_size, 3);
  assert.equal(result.returned, 2);
  assert.deepEqual(
    result.results.map((r) => r.ticker),
    ["MXRF11", "KNRI11"],
  );
  assert.ok(result.warnings.some((w) => w.includes("disclaimer")));
});

test("merges profile.excluded_tickers with input.exclude_tickers", async () => {
  await enableOutbound({ excluded_tickers: ["MXRF11"] });
  const data: FakeData = {
    universe: [
      { ticker: "MXRF11", name: "MAXI", asset_class: "FII" },
      { ticker: "HGLG11", name: "CSHG", asset_class: "FII" },
      { ticker: "KNRI11", name: "KINEA", asset_class: "FII" },
    ],
    quotes: { MXRF11: q("MXRF11"), HGLG11: q("HGLG11"), KNRI11: q("KNRI11") },
    fundamentals: {
      MXRF11: f("MXRF11", { dividend_yield_pct: 11 }),
      HGLG11: f("HGLG11", { dividend_yield_pct: 8 }),
      KNRI11: f("KNRI11", { dividend_yield_pct: 9 }),
    },
  };
  const source = new FakeSource(data);
  const cache = new MarketDataCache(db);
  const result = await screenAssets(
    {
      asset_class: "FII",
      criteria: {
        sort_by: "dividend_yield",
        order: "desc",
        filters: {},
        limit: 5,
      },
      exclude_tickers: ["HGLG11"],
    },
    { source, cache },
  );
  assert.deepEqual(
    result.results.map((r) => r.ticker),
    ["KNRI11"],
  );
});

test("emits warning when a candidate's data is unavailable but does not abort", async () => {
  await enableOutbound();
  const data: FakeData = {
    universe: [
      { ticker: "GOOD1", name: "G", asset_class: "FII" },
      { ticker: "BAD1", name: "B", asset_class: "FII" },
    ],
    quotes: { GOOD1: q("GOOD1") },
    fundamentals: { GOOD1: f("GOOD1", { dividend_yield_pct: 7 }) },
  };
  const source = new FakeSource(data);
  const cache = new MarketDataCache(db);
  const result = await screenAssets(
    {
      asset_class: "FII",
      criteria: {
        sort_by: "dividend_yield",
        order: "desc",
        filters: {},
        limit: 5,
      },
      exclude_tickers: [],
    },
    { source, cache },
  );
  assert.deepEqual(
    result.results.map((r) => r.ticker),
    ["GOOD1"],
  );
  assert.ok(result.warnings.some((w) => w.includes("BAD1")));
});

test("filtered_size reports post-filter count", async () => {
  await enableOutbound();
  const data: FakeData = {
    universe: [
      { ticker: "A1A1", name: "A", asset_class: "FII" },
      { ticker: "B2B2", name: "B", asset_class: "FII" },
    ],
    quotes: { A1A1: q("A1A1"), B2B2: q("B2B2") },
    fundamentals: {
      A1A1: f("A1A1", { dividend_yield_pct: 5 }),
      B2B2: f("B2B2", { dividend_yield_pct: 10 }),
    },
  };
  const source = new FakeSource(data);
  const cache = new MarketDataCache(db);
  const result = await screenAssets(
    {
      asset_class: "FII",
      criteria: {
        sort_by: "dividend_yield",
        order: "desc",
        filters: { min_dividend_yield_pct: 8 },
        limit: 5,
      },
      exclude_tickers: [],
    },
    { source, cache },
  );
  assert.equal(result.universe_size, 2);
  assert.equal(result.filtered_size, 1);
  assert.equal(result.returned, 1);
});
