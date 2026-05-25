import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import {
  listPositions,
  upsertCryptoPosition,
} from "../storage/positions-repo.js";
import {
  TickerNotFoundError,
  OutboundDisabledError,
} from "../advisor/errors.js";
import { saveProfile, advisorProfileSchema } from "../advisor/profile.js";
import { setCryptoPosition, DISCLAIMER } from "./set-crypto-position.js";
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
  tempDir = mkdtempSync(join(tmpdir(), "xp-mcp-setcp-"));
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

test("happy path: stores a CRIPTO position snapshot and echoes the source", async () => {
  await enableOutbound();
  const source = new StubCryptoSource();
  const result = await setCryptoPosition(
    { ticker: "BTC", quantity: 2 },
    { source, db },
  );

  assert.equal(result.ok, true);
  assert.equal(result.removed, false);
  assert.ok(result.position);
  assert.equal(result.position?.ticker, "BTC");
  assert.equal(result.position?.quantity, 2);
  // round(350000 * 100) and round(2 * 350000 * 100)
  assert.equal(result.position?.current_price_cents, 35_000_000);
  assert.equal(result.position?.market_value_cents, 70_000_000);
  assert.equal(result.source, "mercadobitcoin");
  assert.ok(result.warnings.includes(DISCLAIMER));

  const rows = listPositions(db, { assetClass: "CRIPTO" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].external_id, "BTC");
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].market_value_cents, 70_000_000);
});

test("quantity:0 deletes an existing holding and returns removed:true", async () => {
  await enableOutbound();
  upsertCryptoPosition(db, {
    ticker: "BTC",
    name: "BTC",
    quantity: 1,
    current_price_cents: 35_000_000,
    market_value_cents: 35_000_000,
  });
  const source = new StubCryptoSource();

  const result = await setCryptoPosition(
    { ticker: "BTC", quantity: 0 },
    { source, db },
  );

  assert.equal(result.ok, true);
  assert.equal(result.removed, true);
  assert.equal(result.ticker, "BTC");
  assert.ok(result.warnings.includes(DISCLAIMER));
  // No quote fetch needed for a removal.
  assert.equal(source.calls, 0, "removal must not fetch a quote");
  assert.equal(listPositions(db, { assetClass: "CRIPTO" }).length, 0);
});

test("quantity:0 on a non-existent holding is an idempotent no-op", async () => {
  await enableOutbound();
  const source = new StubCryptoSource();

  const result = await setCryptoPosition(
    { ticker: "DOGE", quantity: 0 },
    { source, db },
  );

  assert.equal(result.removed, true);
  assert.equal(listPositions(db, { assetClass: "CRIPTO" }).length, 0);
});

test("ticker not found: returns a per-tool error and writes no position", async () => {
  await enableOutbound();
  const source = new StubCryptoSource(
    (ticker) => new TickerNotFoundError(ticker),
  );

  const result = await setCryptoPosition(
    { ticker: "FAKE", quantity: 1 },
    { source, db },
  );

  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(result.error?.code, "TICKER_NOT_FOUND");
  assert.equal(listPositions(db, { assetClass: "CRIPTO" }).length, 0);
});

test("outbound disabled: throws OutboundDisabledError and writes no position", async () => {
  await saveProfile(
    advisorProfileSchema.parse({
      risk_tolerance: 5,
      horizon_years: 10,
      objective: "balanced",
    }),
  );
  const source = new StubCryptoSource();

  await assert.rejects(
    setCryptoPosition({ ticker: "BTC", quantity: 1 }, { source, db }),
    (e: unknown) => e instanceof OutboundDisabledError,
  );
  assert.equal(source.calls, 0);
  assert.equal(listPositions(db, { assetClass: "CRIPTO" }).length, 0);
});

test("fractional quantity computes market value correctly", async () => {
  await enableOutbound();
  const source = new StubCryptoSource((ticker) => ({
    ticker,
    price_brl: 350000,
    high_brl: 352000,
    low_brl: 348000,
    buy_brl: 349900,
    sell_brl: 350100,
    volume: 123.45,
    updated_at: "2026-05-24T00:00:00.000Z",
    source: "mercadobitcoin",
  }));

  const result = await setCryptoPosition(
    { ticker: "BTC", quantity: 0.5 },
    { source, db },
  );

  assert.equal(result.position?.quantity, 0.5);
  // round(0.5 * 350000 * 100)
  assert.equal(result.position?.market_value_cents, 17_500_000);
  assert.equal(result.position?.current_price_cents, 35_000_000);
});
