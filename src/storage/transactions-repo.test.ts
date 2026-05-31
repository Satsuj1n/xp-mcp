import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "./schema.js";
import { listTransactions } from "./transactions-repo.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

function seed(db: Database.Database): void {
  const stmt = db.prepare(
    `INSERT INTO transactions
       (trade_date, asset_class, external_id, side, quantity, price_cents,
        settle_date, fees_cents, total_cents, broker_note_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Insert out of date order so ORDER BY is actually exercised.
  stmt.run(
    "2026-01-10",
    "ACAO",
    "BBAS3",
    "BUY",
    100,
    3000,
    "2026-01-12",
    50,
    300050,
    "N1",
  );
  stmt.run(
    "2026-03-05",
    "ACAO",
    "BBAS3",
    "SELL",
    50,
    3200,
    "2026-03-07",
    25,
    159975,
    "N2",
  );
  stmt.run(
    "2026-02-01",
    "FII",
    "MXRF11",
    "BUY",
    200,
    1000,
    "2026-02-03",
    10,
    200010,
    "N3",
  );
}

test("listTransactions: filters by ticker, orders by trade_date DESC, honors limit", () => {
  const db = makeDb();
  seed(db);

  const all = listTransactions(db, {}, 100);
  assert.deepEqual(
    all.map((r) => r.trade_date),
    ["2026-03-05", "2026-02-01", "2026-01-10"],
    "expected newest-first ordering",
  );

  const bbas = listTransactions(db, { external_id: "BBAS3" }, 100);
  assert.equal(bbas.length, 2);
  assert.ok(bbas.every((r) => r.external_id === "BBAS3"));

  const limited = listTransactions(db, {}, 1);
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.trade_date, "2026-03-05", "limit keeps the newest");
});
