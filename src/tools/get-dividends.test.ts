import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { getDividends } from "./get-dividends.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

test("getDividends: maps cents→BRL, echoes filters, counts rows", async () => {
  const db = makeDb();
  db.prepare(
    `INSERT INTO dividends
       (pay_date, ex_date, asset_class, external_id, kind, gross_cents, tax_cents, net_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("2026-02-15", "2026-02-02", "ACAO", "BBAS3", "JCP", 5000, 750, 4250);

  const res = await getDividends({ ticker: "BBAS3", limit: 100 }, { db });

  assert.equal(res.count, 1);
  assert.equal(res.filters.ticker, "BBAS3");
  assert.equal(res.filters.limit, 100);

  const row = res.rows[0];
  assert.ok(row);
  assert.equal(row.ticker, "BBAS3");
  assert.equal(row.kind, "JCP");
  assert.equal(row.gross_brl, 50); // 5000 cents
  assert.equal(row.tax_brl, 7.5); // 750 cents
  assert.equal(row.net_brl, 42.5); // 4250 cents
});
