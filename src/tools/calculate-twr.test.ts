import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { createImportRecord } from "../storage/positions-repo.js";
import { insertCashFlows } from "../storage/cash-flows-repo.js";
import { calculateTwr, InsufficientHistoryError } from "./calculate-twr.js";

function withSeededDb(seed: (db: Database.Database) => void): {
  db: Database.Database;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-twr-tool-"));
  const db = new Database(join(dir, "data.db"));
  applySchema(db);
  seed(db);
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("calculate_twr: happy path — 2 imports + 1 cash flow returns full TwrResult shape", async () => {
  // Recent dates so the stale-tail warning does NOT fire.
  const now = new Date("2026-05-24T12:00:00Z");
  const { db, cleanup } = withSeededDb((db) => {
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x1.pdf",
      totalRows: 1,
      declaredTotalCents: 10_000_000, // R$ 100,000
      referenceDate: "2026-04-01",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x2.pdf",
      totalRows: 1,
      declaredTotalCents: 11_500_000, // R$ 115,000
      referenceDate: "2026-05-02",
    });
    const cashImportId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/extract.pdf",
      totalRows: 1,
    });
    insertCashFlows(
      db,
      [
        {
          flow_datetime: "2026-04-16 10:00:00",
          flow_date: "2026-04-16",
          kind: "APORTE",
          amount_cents: 1_000_000, // R$ 10,000
          description: "Aporte mid-period",
        },
      ],
      cashImportId,
    );
  });
  try {
    const out = await calculateTwr({}, { db, now });
    assert.equal(out.period_from, "2026-04-01");
    assert.equal(out.period_to, "2026-05-02");
    assert.equal(out.days, 31);
    assert.equal(out.snapshots_used, 2);
    assert.equal(out.cash_flows_used, 1);
    assert.equal(out.sub_periods.length, 1);
    assert.ok(
      out.twr_period > 0,
      `expected positive TWR, got ${out.twr_period}`,
    );
    // Modified Dietz canonical CFA example yields ~4.755%
    assert.ok(
      Math.abs(out.twr_period - 0.04755) < 0.001,
      `expected ~0.04755, got ${out.twr_period}`,
    );
    assert.equal(typeof out.twr_annualized, "number");
    // 31 days < 60 days, no stale-tail warning expected
    assert.ok(
      !out.warnings.some((w) => w.includes("Last snapshot is from")),
      `unexpected stale-tail warning: ${JSON.stringify(out.warnings)}`,
    );
  } finally {
    cleanup();
  }
});

test("calculate_twr: insufficient history (1 import) throws InsufficientHistoryError", async () => {
  const { db, cleanup } = withSeededDb((db) => {
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x1.pdf",
      totalRows: 1,
      declaredTotalCents: 10_000_000,
      referenceDate: "2026-04-01",
    });
  });
  try {
    await assert.rejects(
      async () => {
        await calculateTwr({}, { db });
      },
      (err: unknown) => {
        assert.ok(
          err instanceof InsufficientHistoryError,
          "expected InsufficientHistoryError",
        );
        assert.ok(
          (err as Error).message.includes(
            "Need at least 2 XPerformance imports",
          ),
          `unexpected message: ${(err as Error).message}`,
        );
        assert.ok(
          (err as Error).message.includes("Found 1"),
          `unexpected message: ${(err as Error).message}`,
        );
        return true;
      },
    );
  } finally {
    cleanup();
  }
});

test("calculate_twr: period_from + period_to clamp the snapshot window", async () => {
  const now = new Date("2026-05-24T12:00:00Z");
  const { db, cleanup } = withSeededDb((db) => {
    // 4 imports across 12 months
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x1.pdf",
      totalRows: 1,
      declaredTotalCents: 10_000_000,
      referenceDate: "2025-06-01",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x2.pdf",
      totalRows: 1,
      declaredTotalCents: 10_500_000,
      referenceDate: "2025-09-01",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x3.pdf",
      totalRows: 1,
      declaredTotalCents: 11_000_000,
      referenceDate: "2026-01-01",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x4.pdf",
      totalRows: 1,
      declaredTotalCents: 11_500_000,
      referenceDate: "2026-05-01",
    });
  });
  try {
    // Narrow window: should only see 2 snapshots (the Jan + May ones)
    const out = await calculateTwr(
      { period_from: "2025-12-01", period_to: "2026-05-15" },
      { db, now },
    );
    assert.equal(out.snapshots_used, 2);
    assert.equal(out.period_from, "2026-01-01");
    assert.equal(out.period_to, "2026-05-01");
    assert.equal(out.sub_periods.length, 1);
  } finally {
    cleanup();
  }
});

test("calculate_twr: stale-tail warning when last snapshot is > 60 days before now", async () => {
  // now = 2026-05-24, last snapshot = 2026-01-15 → ~129 days old → stale.
  const now = new Date("2026-05-24T12:00:00Z");
  const { db, cleanup } = withSeededDb((db) => {
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x1.pdf",
      totalRows: 1,
      declaredTotalCents: 10_000_000,
      referenceDate: "2025-11-01",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x2.pdf",
      totalRows: 1,
      declaredTotalCents: 10_500_000,
      referenceDate: "2026-01-15",
    });
  });
  try {
    const out = await calculateTwr({}, { db, now });
    assert.ok(
      out.warnings.some(
        (w) =>
          w.includes("Last snapshot is from 2026-01-15") &&
          w.includes("Import a fresh"),
      ),
      `expected stale-tail warning, got: ${JSON.stringify(out.warnings)}`,
    );
  } finally {
    cleanup();
  }
});
