import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { getTransactions } from "./get-transactions.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

test("getTransactions: maps cents→BRL, echoes filters, counts rows", async () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO transactions
       (trade_date, asset_class, external_id, side, quantity, price_cents, fees_cents, total_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("2026-01-10", "ACAO", "BBAS3", "BUY", 100, 3000, 50, 300050);

  const res = await getTransactions({ ticker: "BBAS3", limit: 100 }, { db });

  assert.equal(res.count, 1);
  assert.equal(res.filters.ticker, "BBAS3");
  assert.equal(res.filters.limit, 100);

  const row = res.rows[0];
  assert.ok(row);
  assert.equal(row.ticker, "BBAS3");
  assert.equal(row.price_brl, 30); // 3000 cents
  assert.equal(row.fees_brl, 0.5); // 50 cents
  assert.equal(row.total_brl, 3000.5); // 300050 cents
});
