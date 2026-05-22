import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { insertCashFlows } from "../storage/cash-flows-repo.js";
import { createImportRecord } from "../storage/positions-repo.js";
import { getCashFlows } from "./get-cash-flows.js";
import type { ParsedCashFlow } from "../adapters/xp/pdf-bank-extract.js";

function withTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-get-cf-"));
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

function seed(db: Database.Database, rows: ParsedCashFlow[]): void {
  const importId = createImportRecord(db, {
    sourceType: "pdf_bank_extract",
    sourcePath: "/tmp/x.pdf",
    totalRows: rows.length,
  });
  insertCashFlows(db, rows, importId);
}

const ALL_FLOWS: ParsedCashFlow[] = [
  {
    flow_datetime: "2026-05-19 07:03:19",
    flow_date: "2026-05-19",
    kind: "APORTE",
    amount_cents: 550000,
    description: "Transferência enviada para conta investimento",
  },
  {
    flow_datetime: "2026-05-20 11:25:21",
    flow_date: "2026-05-20",
    kind: "APORTE",
    amount_cents: 100000,
    description: "Transferência enviada para conta investimento",
  },
  {
    flow_datetime: "2026-05-21 10:30:44",
    flow_date: "2026-05-21",
    kind: "RESGATE",
    amount_cents: 25000,
    description: "Transferência recebida da conta investimento",
  },
  {
    flow_datetime: "2026-04-28 11:23:00",
    flow_date: "2026-04-28",
    kind: "APORTE",
    amount_cents: 6992,
    description: "Transferência enviada para a conta investimento",
  },
];

test("getCashFlows: returns all rows when filters are empty", async () => {
  const { db, cleanup } = withTempDb();
  try {
    seed(db, ALL_FLOWS);
    const result = await getCashFlows({ limit: 100 }, { db });
    assert.equal(result.count, 4);
    assert.equal(result.rows.length, 4);
  } finally {
    cleanup();
  }
});

test("getCashFlows: rows are sorted by flow_datetime DESC", async () => {
  const { db, cleanup } = withTempDb();
  try {
    seed(db, ALL_FLOWS);
    const result = await getCashFlows({ limit: 100 }, { db });
    assert.equal(result.rows[0].flow_date, "2026-05-21");
    assert.equal(result.rows[1].flow_date, "2026-05-20");
    assert.equal(result.rows[2].flow_date, "2026-05-19");
    assert.equal(result.rows[3].flow_date, "2026-04-28");
  } finally {
    cleanup();
  }
});

test("getCashFlows: filters by kind", async () => {
  const { db, cleanup } = withTempDb();
  try {
    seed(db, ALL_FLOWS);
    const aportes = await getCashFlows({ kind: "APORTE", limit: 100 }, { db });
    assert.equal(aportes.count, 3);
    assert.ok(aportes.rows.every((r) => r.kind === "APORTE"));
  } finally {
    cleanup();
  }
});

test("getCashFlows: filters by date range (inclusive)", async () => {
  const { db, cleanup } = withTempDb();
  try {
    seed(db, ALL_FLOWS);
    const result = await getCashFlows(
      { date_from: "2026-05-19", date_to: "2026-05-20", limit: 100 },
      { db },
    );
    assert.equal(result.count, 2);
  } finally {
    cleanup();
  }
});

test("getCashFlows: totals_brl over ALL matching rows, ignoring limit", async () => {
  const { db, cleanup } = withTempDb();
  try {
    seed(db, ALL_FLOWS);
    const result = await getCashFlows({ limit: 1 }, { db });
    // Only 1 row returned, but totals reflect all 4.
    assert.equal(result.rows.length, 1);
    assert.equal(result.totals_brl.aporte_total, 6569.92);
    assert.equal(result.totals_brl.resgate_total, 250);
    assert.equal(result.totals_brl.net, 6319.92);
  } finally {
    cleanup();
  }
});

test("getCashFlows: filtered totals match filtered rows", async () => {
  const { db, cleanup } = withTempDb();
  try {
    seed(db, ALL_FLOWS);
    const result = await getCashFlows(
      { kind: "APORTE", date_from: "2026-05-19", limit: 100 },
      { db },
    );
    assert.equal(result.totals_brl.aporte_total, 6500);
    assert.equal(result.totals_brl.resgate_total, 0);
    assert.equal(result.totals_brl.net, 6500);
  } finally {
    cleanup();
  }
});

test("getCashFlows: empty result is well-formed", async () => {
  const { db, cleanup } = withTempDb();
  try {
    const result = await getCashFlows({ limit: 100 }, { db });
    assert.equal(result.count, 0);
    assert.deepEqual(result.rows, []);
    assert.equal(result.totals_brl.aporte_total, 0);
    assert.equal(result.totals_brl.resgate_total, 0);
    assert.equal(result.totals_brl.net, 0);
  } finally {
    cleanup();
  }
});

test("getCashFlows: filters object reflects input (nulls for missing)", async () => {
  const { db, cleanup } = withTempDb();
  try {
    const result = await getCashFlows({ kind: "APORTE", limit: 50 }, { db });
    assert.equal(result.filters.kind, "APORTE");
    assert.equal(result.filters.date_from, null);
    assert.equal(result.filters.date_to, null);
    assert.equal(result.filters.limit, 50);
  } finally {
    cleanup();
  }
});
