import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "./schema.js";
import {
  upsertCryptoPosition,
  deleteCryptoPosition,
  listPositions,
} from "./positions-repo.js";

function withTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-positions-repo-"));
  const db = new Database(join(dir, "data.db"));
  applySchema(db);
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("upsertCryptoPosition inserts a CRIPTO row with manual-entry fields nulled", () => {
  const { db, cleanup } = withTempDb();
  try {
    upsertCryptoPosition(db, {
      ticker: "BTC",
      name: "BTC",
      quantity: 0.5,
      current_price_cents: 35_000_000,
      market_value_cents: 17_500_000,
    });

    const rows = listPositions(db, { assetClass: "CRIPTO" });
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.asset_class, "CRIPTO");
    assert.equal(row.external_id, "BTC");
    assert.equal(row.name, "BTC");
    assert.equal(row.quantity, 0.5);
    assert.equal(row.current_price_cents, 35_000_000);
    assert.equal(row.market_value_cents, 17_500_000);
    // Manual entry has no cost basis / fixed-income metadata.
    assert.equal(row.avg_price_cents, null);
    assert.equal(row.invested_cents, null);
    assert.equal(row.issuer, null);
    assert.equal(row.indexer, null);
    assert.equal(row.rate, null);
    assert.equal(row.maturity_date, null);
    assert.equal(row.has_fgc, null);
  } finally {
    cleanup();
  }
});

test("upsertCryptoPosition re-upsert updates quantity/value and stays a single row", () => {
  const { db, cleanup } = withTempDb();
  try {
    upsertCryptoPosition(db, {
      ticker: "ETH",
      name: "ETH",
      quantity: 1,
      current_price_cents: 1_000_000,
      market_value_cents: 1_000_000,
    });
    upsertCryptoPosition(db, {
      ticker: "ETH",
      name: "ETH",
      quantity: 3,
      current_price_cents: 1_200_000,
      market_value_cents: 3_600_000,
    });

    const rows = listPositions(db, { assetClass: "CRIPTO" });
    assert.equal(rows.length, 1, "re-upsert must not duplicate the row");
    assert.equal(rows[0].quantity, 3);
    assert.equal(rows[0].current_price_cents, 1_200_000);
    assert.equal(rows[0].market_value_cents, 3_600_000);
  } finally {
    cleanup();
  }
});

test("deleteCryptoPosition removes the CRIPTO row", () => {
  const { db, cleanup } = withTempDb();
  try {
    upsertCryptoPosition(db, {
      ticker: "SOL",
      name: "SOL",
      quantity: 10,
      current_price_cents: 50_000,
      market_value_cents: 500_000,
    });
    assert.equal(listPositions(db, { assetClass: "CRIPTO" }).length, 1);

    deleteCryptoPosition(db, "SOL");
    assert.equal(listPositions(db, { assetClass: "CRIPTO" }).length, 0);
  } finally {
    cleanup();
  }
});

test("deleteCryptoPosition is a no-op for a missing row", () => {
  const { db, cleanup } = withTempDb();
  try {
    // Should not throw, and leaves the table untouched.
    assert.doesNotThrow(() => deleteCryptoPosition(db, "DOGE"));
    assert.equal(listPositions(db, { assetClass: "CRIPTO" }).length, 0);
  } finally {
    cleanup();
  }
});
