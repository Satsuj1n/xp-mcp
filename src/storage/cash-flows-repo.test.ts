import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "./schema.js";
import {
  insertCashFlows,
  listCashFlows,
  listCashFlowsSince,
  sumCashFlows,
} from "./cash-flows-repo.js";
import type { ParsedCashFlow } from "../adapters/xp/pdf-bank-extract.js";
import { createImportRecord } from "./positions-repo.js";

function withTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-cashflows-"));
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

function makeFlow(overrides: Partial<ParsedCashFlow> = {}): ParsedCashFlow {
  return {
    flow_datetime: "2026-05-19 07:03:19",
    flow_date: "2026-05-19",
    kind: "APORTE",
    amount_cents: 550000,
    description: "Transferência enviada para conta investimento",
    ...overrides,
  };
}

test("insertCashFlows inserts new rows and returns counts", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 2,
    });
    const result = insertCashFlows(
      db,
      [
        makeFlow(),
        makeFlow({
          flow_datetime: "2026-05-20 11:25:21",
          flow_date: "2026-05-20",
          amount_cents: 1769,
        }),
      ],
      importId,
    );
    assert.equal(result.inserted, 2);
    assert.equal(result.skipped, 0);

    const rows = db.prepare("SELECT COUNT(*) AS c FROM cash_flows").get() as {
      c: number;
    };
    assert.equal(rows.c, 2);
  } finally {
    cleanup();
  }
});

test("insertCashFlows is idempotent on duplicate (flow_datetime, amount_cents, kind)", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 2,
    });
    const result1 = insertCashFlows(db, [makeFlow()], importId);
    assert.equal(result1.inserted, 1);

    // Re-insert the exact same flow: skipped, not duplicated.
    const result2 = insertCashFlows(db, [makeFlow()], importId);
    assert.equal(result2.inserted, 0);
    assert.equal(result2.skipped, 1);

    const total = db.prepare("SELECT COUNT(*) AS c FROM cash_flows").get() as {
      c: number;
    };
    assert.equal(total.c, 1);
  } finally {
    cleanup();
  }
});

test("listCashFlows returns rows ordered by flow_datetime DESC", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 3,
    });
    insertCashFlows(
      db,
      [
        makeFlow({
          flow_datetime: "2026-05-19 07:03:19",
          flow_date: "2026-05-19",
        }),
        makeFlow({
          flow_datetime: "2026-05-20 11:25:21",
          flow_date: "2026-05-20",
          amount_cents: 1769,
        }),
        makeFlow({
          flow_datetime: "2026-05-18 19:15:08",
          flow_date: "2026-05-18",
          amount_cents: 3932,
        }),
      ],
      importId,
    );

    const rows = listCashFlows(db, {}, 100);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].flow_date, "2026-05-20");
    assert.equal(rows[1].flow_date, "2026-05-19");
    assert.equal(rows[2].flow_date, "2026-05-18");
  } finally {
    cleanup();
  }
});

test("listCashFlows filters by date_from / date_to (inclusive)", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 3,
    });
    insertCashFlows(
      db,
      [
        makeFlow({
          flow_datetime: "2026-05-18 19:15:08",
          flow_date: "2026-05-18",
          amount_cents: 100,
        }),
        makeFlow({
          flow_datetime: "2026-05-19 07:03:19",
          flow_date: "2026-05-19",
          amount_cents: 200,
        }),
        makeFlow({
          flow_datetime: "2026-05-20 11:25:21",
          flow_date: "2026-05-20",
          amount_cents: 300,
        }),
      ],
      importId,
    );

    const rows = listCashFlows(
      db,
      { date_from: "2026-05-19", date_to: "2026-05-19" },
      100,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].amount_cents, 200);
  } finally {
    cleanup();
  }
});

test("listCashFlows filters by kind", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 2,
    });
    insertCashFlows(
      db,
      [
        makeFlow({ kind: "APORTE" }),
        makeFlow({
          kind: "RESGATE",
          flow_datetime: "2026-05-19 10:30:44",
          amount_cents: 2590,
        }),
      ],
      importId,
    );

    const aportes = listCashFlows(db, { kind: "APORTE" }, 100);
    assert.equal(aportes.length, 1);
    assert.equal(aportes[0].kind, "APORTE");

    const resgates = listCashFlows(db, { kind: "RESGATE" }, 100);
    assert.equal(resgates.length, 1);
    assert.equal(resgates[0].kind, "RESGATE");
  } finally {
    cleanup();
  }
});

test("listCashFlows respects limit", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 3,
    });
    insertCashFlows(
      db,
      [
        makeFlow({
          flow_datetime: "2026-05-18 19:15:08",
          flow_date: "2026-05-18",
          amount_cents: 100,
        }),
        makeFlow({
          flow_datetime: "2026-05-19 07:03:19",
          flow_date: "2026-05-19",
          amount_cents: 200,
        }),
        makeFlow({
          flow_datetime: "2026-05-20 11:25:21",
          flow_date: "2026-05-20",
          amount_cents: 300,
        }),
      ],
      importId,
    );

    const rows = listCashFlows(db, {}, 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].flow_date, "2026-05-20");
    assert.equal(rows[1].flow_date, "2026-05-19");
  } finally {
    cleanup();
  }
});

test("sumCashFlows aggregates totals (no filters)", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 3,
    });
    insertCashFlows(
      db,
      [
        makeFlow({ kind: "APORTE", amount_cents: 100000 }),
        makeFlow({
          kind: "APORTE",
          flow_datetime: "2026-05-20 07:03:19",
          amount_cents: 50000,
        }),
        makeFlow({
          kind: "RESGATE",
          flow_datetime: "2026-05-21 10:30:44",
          amount_cents: 25000,
        }),
      ],
      importId,
    );

    const totals = sumCashFlows(db, {});
    assert.equal(totals.aporte_cents, 150000);
    assert.equal(totals.resgate_cents, 25000);
  } finally {
    cleanup();
  }
});

test("sumCashFlows respects filters and IGNORES limit", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 3,
    });
    insertCashFlows(
      db,
      [
        makeFlow({
          kind: "APORTE",
          amount_cents: 100000,
          flow_datetime: "2026-05-18 07:03:19",
          flow_date: "2026-05-18",
        }),
        makeFlow({
          kind: "APORTE",
          amount_cents: 50000,
          flow_datetime: "2026-05-19 07:03:19",
          flow_date: "2026-05-19",
        }),
        makeFlow({
          kind: "APORTE",
          amount_cents: 25000,
          flow_datetime: "2026-05-20 07:03:19",
          flow_date: "2026-05-20",
        }),
      ],
      importId,
    );

    const totals = sumCashFlows(db, { date_from: "2026-05-19" });
    assert.equal(totals.aporte_cents, 75000);
    assert.equal(totals.resgate_cents, 0);
  } finally {
    cleanup();
  }
});

test("sumCashFlows returns zeros when no rows match", () => {
  const { db, cleanup } = withTempDb();
  try {
    const totals = sumCashFlows(db, {});
    assert.equal(totals.aporte_cents, 0);
    assert.equal(totals.resgate_cents, 0);
  } finally {
    cleanup();
  }
});

test("listCashFlowsSince: returns only rows with flow_date >= dateFrom", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 3,
    });
    insertCashFlows(
      db,
      [
        makeFlow({
          flow_datetime: "2025-04-30 09:00:00",
          flow_date: "2025-04-30",
          amount_cents: 100,
        }),
        makeFlow({
          flow_datetime: "2025-05-01 09:00:00",
          flow_date: "2025-05-01",
          amount_cents: 200,
        }),
        makeFlow({
          flow_datetime: "2025-05-02 09:00:00",
          flow_date: "2025-05-02",
          amount_cents: 300,
        }),
      ],
      importId,
    );

    const rows = listCashFlowsSince(db, "2025-05-01");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].flow_date, "2025-05-01");
    assert.equal(rows[1].flow_date, "2025-05-02");
  } finally {
    cleanup();
  }
});

test("listCashFlowsSince: sorted by flow_date ASC, id ASC", () => {
  const { db, cleanup } = withTempDb();
  try {
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 4,
    });
    // Insertion order is intentionally scrambled to prove the SQL ORDER BY
    // (not insertion order) governs the result.
    // Idempotency key is (flow_datetime, amount_cents, kind), so each row
    // gets a distinct flow_datetime to avoid being skipped.
    insertCashFlows(
      db,
      [
        makeFlow({
          flow_datetime: "2025-05-01 09:00:00",
          flow_date: "2025-05-01",
          amount_cents: 1001,
        }),
        makeFlow({
          flow_datetime: "2025-04-30 09:00:00",
          flow_date: "2025-04-30",
          amount_cents: 2001,
        }),
        makeFlow({
          flow_datetime: "2025-05-01 15:00:00",
          flow_date: "2025-05-01",
          amount_cents: 1002,
        }),
        makeFlow({
          flow_datetime: "2025-04-30 15:00:00",
          flow_date: "2025-04-30",
          amount_cents: 2002,
        }),
      ],
      importId,
    );

    const rows = listCashFlowsSince(db, "2025-04-30");
    assert.equal(rows.length, 4);
    // Two April rows first (by id ASC), then two May rows (by id ASC).
    // Insertion order above: id 1 = May/1001, id 2 = Apr/2001,
    // id 3 = May/1002, id 4 = Apr/2002.
    // Expected ASC by flow_date then id: Apr id=2, Apr id=4, May id=1, May id=3.
    assert.equal(rows[0].flow_date, "2025-04-30");
    assert.equal(rows[0].amount_cents, 2001);
    assert.equal(rows[1].flow_date, "2025-04-30");
    assert.equal(rows[1].amount_cents, 2002);
    assert.equal(rows[2].flow_date, "2025-05-01");
    assert.equal(rows[2].amount_cents, 1001);
    assert.equal(rows[3].flow_date, "2025-05-01");
    assert.equal(rows[3].amount_cents, 1002);
    // And ids strictly ascending within each date.
    assert.ok(rows[0].id < rows[1].id);
    assert.ok(rows[2].id < rows[3].id);
  } finally {
    cleanup();
  }
});

test("listCashFlowsSince: empty result on no matches", () => {
  const { db, cleanup } = withTempDb();
  try {
    // Empty DB → empty result.
    assert.deepEqual(listCashFlowsSince(db, "2025-05-01"), []);

    // And: row dated strictly before dateFrom → still empty.
    const importId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/x.pdf",
      totalRows: 1,
    });
    insertCashFlows(
      db,
      [
        makeFlow({
          flow_datetime: "2025-04-30 09:00:00",
          flow_date: "2025-04-30",
          amount_cents: 100,
        }),
      ],
      importId,
    );
    assert.deepEqual(listCashFlowsSince(db, "2025-05-01"), []);
  } finally {
    cleanup();
  }
});
