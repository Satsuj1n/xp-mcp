import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "./schema.js";

function withTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-schema-"));
  const db = new Database(join(dir, "data.db"));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("market_data_cache table exists after applySchema", () => {
  const { db, cleanup } = withTempDb();
  try {
    applySchema(db);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='market_data_cache'",
      )
      .get();
    assert.ok(row, "market_data_cache table should exist");
  } finally {
    cleanup();
  }
});

test("market_data_cache columns and PK", () => {
  const { db, cleanup } = withTempDb();
  try {
    applySchema(db);
    const cols = db
      .prepare("PRAGMA table_info(market_data_cache)")
      .all() as Array<{
      name: string;
      type: string;
      pk: number;
    }>;
    const names = cols.map((c) => c.name).sort();
    assert.deepEqual(names, [
      "cached_at",
      "data_type",
      "payload_json",
      "source",
      "ticker",
    ]);
    const pkCols = cols
      .filter((c) => c.pk > 0)
      .map((c) => c.name)
      .sort();
    assert.deepEqual(pkCols, ["data_type", "source", "ticker"]);
  } finally {
    cleanup();
  }
});

test("idx_mdc_cached_at index exists", () => {
  const { db, cleanup } = withTempDb();
  try {
    applySchema(db);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mdc_cached_at'",
      )
      .get();
    assert.ok(row, "idx_mdc_cached_at index should exist");
  } finally {
    cleanup();
  }
});

test("applySchema is idempotent (running twice does not throw)", () => {
  const { db, cleanup } = withTempDb();
  try {
    applySchema(db);
    applySchema(db);
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM market_data_cache")
      .get() as { n: number };
    assert.equal(row.n, 0);
  } finally {
    cleanup();
  }
});

test("cash_flows table exists after applySchema", () => {
  const { db, cleanup } = withTempDb();
  try {
    applySchema(db);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='cash_flows'",
      )
      .get();
    assert.ok(row, "cash_flows table should exist after applySchema");
  } finally {
    cleanup();
  }
});
