import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { applySchema } from "./schema.js";
import { listDividends } from "./dividends-repo.js";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  applySchema(db);
  return db;
}

function seed(db: Database.Database): void {
  const stmt = db.prepare(
    `INSERT INTO dividends
       (pay_date, ex_date, asset_class, external_id, kind, gross_cents, tax_cents, net_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Insert out of date order so ORDER BY is actually exercised.
  stmt.run(
    "2026-01-15",
    "2026-01-02",
    "FII",
    "MXRF11",
    "RENDIMENTO",
    1000,
    0,
    1000,
  );
  stmt.run(
    "2026-03-15",
    "2026-03-02",
    "FII",
    "MXRF11",
    "RENDIMENTO",
    1200,
    0,
    1200,
  );
  stmt.run("2026-02-15", "2026-02-02", "ACAO", "BBAS3", "JCP", 5000, 750, 4250);
}

test("listDividends: filters by ticker, orders by pay_date DESC, honors limit", () => {
  const db = makeDb();
  seed(db);

  const all = listDividends(db, {}, 100);
  assert.deepEqual(
    all.map((r) => r.pay_date),
    ["2026-03-15", "2026-02-15", "2026-01-15"],
    "expected newest-first ordering",
  );

  const mxrf = listDividends(db, { external_id: "MXRF11" }, 100);
  assert.equal(mxrf.length, 2);
  assert.ok(mxrf.every((r) => r.external_id === "MXRF11"));

  const jcp = listDividends(db, { kind: "JCP" }, 100);
  assert.equal(jcp.length, 1);
  assert.equal(jcp[0]?.external_id, "BBAS3");

  const limited = listDividends(db, {}, 1);
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.pay_date, "2026-03-15", "limit keeps the newest");
});
