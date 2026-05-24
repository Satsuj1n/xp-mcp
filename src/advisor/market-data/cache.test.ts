import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../../storage/schema.js";
import { MarketDataCache } from "./cache.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

test("get returns null when no entry", () => {
  const cache = new MarketDataCache(makeDb());
  assert.equal(cache.get("BBAS3", "quote", 60), null);
});

test("put then get returns the same payload with age_seconds", () => {
  const cache = new MarketDataCache(makeDb());
  cache.put("BBAS3", "quote", { price: 30.5 });
  const entry = cache.get<{ price: number }>("BBAS3", "quote", 60);
  assert.ok(entry);
  assert.equal(entry.data.price, 30.5);
  assert.equal(typeof entry.cached_at, "string");
  assert.ok(entry.age_seconds >= 0);
  assert.ok(
    entry.age_seconds < 5,
    `expected fresh entry, age=${entry.age_seconds}s`,
  );
});

test("get returns null when entry is older than maxAgeMinutes", () => {
  const db = makeDb();
  const cache = new MarketDataCache(db);
  // Insert a row 90 minutes in the past
  db.prepare(
    `INSERT INTO market_data_cache (ticker, data_type, source, payload_json, cached_at)
     VALUES (?, ?, 'brapi.dev', ?, datetime('now', '-90 minutes'))`,
  ).run("BBAS3", "quote", JSON.stringify({ price: 30 }));
  assert.equal(cache.get("BBAS3", "quote", 60), null);
});

test("get returns entry when just within maxAgeMinutes", () => {
  const db = makeDb();
  const cache = new MarketDataCache(db);
  db.prepare(
    `INSERT INTO market_data_cache (ticker, data_type, source, payload_json, cached_at)
     VALUES (?, ?, 'brapi.dev', ?, datetime('now', '-30 minutes'))`,
  ).run("BBAS3", "quote", JSON.stringify({ price: 30 }));
  const entry = cache.get("BBAS3", "quote", 60);
  assert.ok(entry);
});

test("put overwrites existing entry (PRIMARY KEY replace)", () => {
  const cache = new MarketDataCache(makeDb());
  cache.put("BBAS3", "quote", { price: 30 });
  cache.put("BBAS3", "quote", { price: 31 });
  const entry = cache.get<{ price: number }>("BBAS3", "quote", 60);
  assert.equal(entry?.data.price, 31);
});

test("different data_type does not collide", () => {
  const cache = new MarketDataCache(makeDb());
  cache.put("BBAS3", "quote", { price: 30 });
  cache.put("BBAS3", "fundamentals", { dy: 5 });
  assert.ok(cache.get("BBAS3", "quote", 60));
  assert.ok(cache.get("BBAS3", "fundamentals", 1440));
});

test("put: explicit source is written to the row", () => {
  const db = makeDb();
  const cache = new MarketDataCache(db);
  cache.put("BTC", "crypto_quote", { price_brl: 350000 }, "mercadobitcoin");
  const row = db
    .prepare("SELECT source FROM market_data_cache WHERE ticker = ?")
    .get("BTC") as { source: string } | undefined;
  assert.equal(row?.source, "mercadobitcoin");
});

test("put: default source remains brapi.dev", () => {
  const db = makeDb();
  const cache = new MarketDataCache(db);
  cache.put("BBAS3", "quote", { price: 30.5 });
  const row = db
    .prepare("SELECT source FROM market_data_cache WHERE ticker = ?")
    .get("BBAS3") as { source: string } | undefined;
  assert.equal(row?.source, "brapi.dev");
});

test("clearExpired removes only expired rows and returns count", () => {
  const db = makeDb();
  const cache = new MarketDataCache(db);
  db.prepare(
    `INSERT INTO market_data_cache (ticker, data_type, source, payload_json, cached_at)
     VALUES ('A', 'quote', 'brapi.dev', '{}', datetime('now', '-90 minutes')),
            ('B', 'quote', 'brapi.dev', '{}', datetime('now', '-10 minutes'))`,
  ).run();
  const deleted = cache.clearExpired(60);
  assert.equal(deleted, 1);
  const remaining = db
    .prepare("SELECT ticker FROM market_data_cache")
    .all() as Array<{ ticker: string }>;
  assert.deepEqual(
    remaining.map((r) => r.ticker),
    ["B"],
  );
});
