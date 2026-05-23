import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suggestBuys } from "./suggest-buys.js";
import { closeDb, getDb } from "../storage/db.js";
import { MarketDataCache } from "../advisor/market-data/cache.js";
import type {
  Fundamentals,
  MarketDataSource,
  Quote,
  UniverseClass,
  UniverseListItem,
} from "../advisor/market-data/source.js";

function makeTempEnv() {
  const dir = mkdtempSync(join(tmpdir(), "suggest-buys-"));
  const dbPath = join(dir, "test.db");
  const profilePath = join(dir, "profile.json");
  const allocPath = join(dir, "allocation.json");
  // Close any prior singleton handle before re-pointing the env var,
  // so getDb() lazily opens a fresh DB on the next call.
  closeDb();
  process.env.XP_MCP_DB_PATH = dbPath;
  process.env.XP_MCP_PROFILE_PATH = profilePath;
  return { dir, profilePath, allocPath };
}

function tearDown(dir: string) {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.XP_MCP_DB_PATH;
  delete process.env.XP_MCP_PROFILE_PATH;
}

function writeProfile(path: string, overrides: Record<string, unknown> = {}) {
  const profile = {
    schema_version: 1,
    outbound_enabled: true,
    accepted_disclaimer_at: "2026-05-23T00:00:00.000Z",
    risk_tolerance: 5,
    horizon_years: 10,
    objective: "income",
    excluded_classes: [],
    excluded_tickers: [],
    notes: "",
    ...overrides,
  };
  writeFileSync(path, JSON.stringify(profile), "utf-8");
}

function writeAllocation(path: string) {
  // Target: 50% FII, 50% ACAO. Portfolio (seeded below) is 100% ACAO,
  // making FII heavily underweight.
  writeFileSync(
    path,
    JSON.stringify({
      target_allocation: { FII: 0.5, ACAO: 0.5 },
      tolerance_pp: 1,
    }),
    "utf-8",
  );
}

function seedPositions() {
  const db = getDb();
  db.prepare(
    `INSERT INTO positions (asset_class, external_id, name, quantity, avg_price_cents, current_price_cents, invested_cents, market_value_cents, last_imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run("ACAO", "BBAS3", "BANCO DO BRASIL ON", 100, 1500, 2000, 150000, 200000);
}

class FakeSource implements MarketDataSource {
  readonly name = "fake";
  constructor(
    private universes: Partial<Record<UniverseClass, UniverseListItem[]>> = {},
    private quotes: Record<string, Quote> = {},
    private fundamentals: Record<string, Fundamentals> = {},
  ) {}
  async listUniverse(cls: UniverseClass): Promise<UniverseListItem[]> {
    return this.universes[cls] ?? [];
  }
  async getQuote(ticker: string): Promise<Quote> {
    const q = this.quotes[ticker];
    if (!q) throw new Error(`no quote for ${ticker}`);
    return q;
  }
  async getFundamentals(ticker: string): Promise<Fundamentals> {
    const f = this.fundamentals[ticker];
    if (!f) throw new Error(`no fundamentals for ${ticker}`);
    return f;
  }
}

function fiiItem(ticker: string, name?: string): UniverseListItem {
  return { ticker, name: name ?? `${ticker} - FII`, asset_class: "FII" };
}

function quote(ticker: string, price = 100, mcap = 1_000_000_000): Quote {
  return {
    ticker,
    price_brl: price,
    change_pct: 0,
    volume: 1_000_000,
    market_cap_brl: mcap,
    updated_at: "2026-05-23T00:00:00Z",
  };
}

function fii_fund(ticker: string, dy = 8): Fundamentals {
  return {
    ticker,
    dividend_yield_pct: dy,
    pvp_ratio: 1.0,
    pl_ratio: null,
    roe_pct: null,
    vacancy_pct: 5,
    updated_at: "2026-05-23T00:00:00Z",
  };
}

test("suggestBuys: happy path — FII underweight, 3 suggestions", async () => {
  const env = makeTempEnv();
  try {
    writeProfile(env.profilePath);
    writeAllocation(env.allocPath);
    seedPositions();
    const source = new FakeSource(
      {
        FII: [
          fiiItem("MXRF11"),
          fiiItem("HGLG11"),
          fiiItem("KNCR11"),
          fiiItem("BTLG11"),
        ],
      },
      {
        MXRF11: quote("MXRF11", 10, 500_000_000),
        HGLG11: quote("HGLG11", 150, 800_000_000),
        KNCR11: quote("KNCR11", 90, 600_000_000),
        BTLG11: quote("BTLG11", 95, 700_000_000),
      },
      {
        MXRF11: fii_fund("MXRF11", 11),
        HGLG11: fii_fund("HGLG11", 10),
        KNCR11: fii_fund("KNCR11", 9.5),
        BTLG11: fii_fund("BTLG11", 7), // passes min_dy=6 but lowest DY → trimmed by limit=top_n=3
      },
    );

    const result = await suggestBuys(
      { top_n: 3, target_path: env.allocPath },
      { source, cache: new MarketDataCache(getDb()) },
    );

    assert.equal(result.suggestions.length, 3);
    for (const s of result.suggestions) assert.equal(s.asset_class, "FII");
    assert.equal(result.suggestions[0]?.ticker, "MXRF11");
    assert.ok(result.suggestions[0]?.amount_brl != null);
    assert.equal(result.skipped_classes.length, 0);
    assert.ok(result.total_to_invest_brl > 0);
    assert.ok(
      result.warnings[0]?.startsWith("[disclaimer]"),
      `expected DISCLAIMER first; got: ${result.warnings[0]}`,
    );
  } finally {
    tearDown(env.dir);
  }
});

test("suggestBuys: default top_n=3", async () => {
  const env = makeTempEnv();
  try {
    writeProfile(env.profilePath);
    writeAllocation(env.allocPath);
    seedPositions();
    const source = new FakeSource(
      {
        FII: [fiiItem("MXRF11"), fiiItem("HGLG11")],
      },
      {
        MXRF11: quote("MXRF11", 10, 500_000_000),
        HGLG11: quote("HGLG11", 150, 800_000_000),
      },
      {
        MXRF11: fii_fund("MXRF11", 11),
        HGLG11: fii_fund("HGLG11", 10),
      },
    );
    const result = await suggestBuys(
      { target_path: env.allocPath },
      { source, cache: new MarketDataCache(getDb()) },
    );
    // Universe only has 2 ⇒ returned=2 even with top_n=3 default.
    assert.equal(result.suggestions.length, 2);
  } finally {
    tearDown(env.dir);
  }
});

test("suggestBuys: outbound_enabled=false throws OutboundDisabledError", async () => {
  const env = makeTempEnv();
  try {
    writeProfile(env.profilePath, { outbound_enabled: false });
    writeAllocation(env.allocPath);
    seedPositions();
    await assert.rejects(
      suggestBuys(
        { target_path: env.allocPath },
        { source: new FakeSource(), cache: new MarketDataCache(getDb()) },
      ),
      /outbound/i,
    );
  } finally {
    tearDown(env.dir);
  }
});

test("suggestBuys: missing allocation file propagates error", async () => {
  const env = makeTempEnv();
  try {
    writeProfile(env.profilePath);
    seedPositions();
    await assert.rejects(
      suggestBuys(
        { target_path: join(env.dir, "does-not-exist.json") },
        { source: new FakeSource(), cache: new MarketDataCache(getDb()) },
      ),
      /allocation/i,
    );
  } finally {
    tearDown(env.dir);
  }
});

test("suggestBuys: already_owned set from listPositions", async () => {
  const env = makeTempEnv();
  try {
    writeProfile(env.profilePath);
    writeAllocation(env.allocPath);
    seedPositions();
    // Add an FII position so it shows already_owned=true if suggested.
    const db = getDb();
    db.prepare(
      `INSERT INTO positions (asset_class, external_id, name, quantity, avg_price_cents, current_price_cents, invested_cents, market_value_cents, last_imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run("FII", "MXRF11", "MAXI RENDA FII", 10, 900, 1000, 9000, 10000);

    const source = new FakeSource(
      { FII: [fiiItem("MXRF11"), fiiItem("HGLG11")] },
      {
        MXRF11: quote("MXRF11", 10, 500_000_000),
        HGLG11: quote("HGLG11", 150, 800_000_000),
      },
      {
        MXRF11: fii_fund("MXRF11", 11),
        HGLG11: fii_fund("HGLG11", 10),
      },
    );
    const result = await suggestBuys(
      { top_n: 3, target_path: env.allocPath },
      { source, cache: new MarketDataCache(getDb()) },
    );
    const mxrf = result.suggestions.find((s) => s.ticker === "MXRF11");
    const hglg = result.suggestions.find((s) => s.ticker === "HGLG11");
    assert.equal(mxrf?.already_owned, true);
    assert.equal(hglg?.already_owned, false);
  } finally {
    tearDown(env.dir);
  }
});

test("suggestBuys: non-screenable underweight class lands in skipped_classes", async () => {
  const env = makeTempEnv();
  try {
    writeProfile(env.profilePath);
    // Target: 100% TESOURO. Portfolio: 100% ACAO. TESOURO heavily underweight,
    // ACAO heavily overweight (overweight is ignored).
    writeFileSync(
      env.allocPath,
      JSON.stringify({
        target_allocation: { TESOURO: 1.0 },
        tolerance_pp: 0,
      }),
      "utf-8",
    );
    seedPositions();
    const result = await suggestBuys(
      { target_path: env.allocPath },
      { source: new FakeSource(), cache: new MarketDataCache(getDb()) },
    );
    assert.equal(result.suggestions.length, 0);
    assert.equal(result.skipped_classes.length, 1);
    assert.equal(result.skipped_classes[0]?.asset_class, "TESOURO");
    assert.ok(result.total_skipped_brl > 0);
  } finally {
    tearDown(env.dir);
  }
});
