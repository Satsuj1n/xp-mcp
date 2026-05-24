import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { createImportRecord } from "../storage/positions-repo.js";
import { insertCashFlows } from "../storage/cash-flows-repo.js";
import { calculateMwr } from "./calculate-mwr.js";
import { InsufficientHistoryError } from "./calculate-twr.js";

function withSeededDb(seed: (db: Database.Database) => void): {
  db: Database.Database;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-mwr-tool-"));
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

test("calculate_mwr: happy path — 2 imports 1Y apart, no cash flows, IRR ≈ 0.10", async () => {
  // Hand-computed: -100,000 + 110,000 / (1+r)^1 = 0 → r = 0.10 exactly.
  const now = new Date("2026-02-01T12:00:00Z");
  const { db, cleanup } = withSeededDb((db) => {
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x1.pdf",
      totalRows: 1,
      declaredTotalCents: 10_000_000, // R$ 100,000
      referenceDate: "2025-01-01",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x2.pdf",
      totalRows: 1,
      declaredTotalCents: 11_000_000, // R$ 110,000
      referenceDate: "2026-01-01",
    });
  });
  try {
    const out = await calculateMwr({}, { db, now });
    assert.equal(out.period_from, "2025-01-01");
    assert.equal(out.period_to, "2026-01-01");
    assert.equal(out.days, 365);
    assert.equal(out.snapshots_used, 2);
    assert.equal(out.cash_flows_used, 0);
    assert.equal(out.converged, true);
    assert.ok(
      out.mwr_annualized !== null,
      "expected mwr_annualized to be non-null",
    );
    assert.ok(
      Math.abs(out.mwr_annualized! - 0.1) < 1e-4,
      `expected mwr_annualized ≈ 0.10, got ${out.mwr_annualized}`,
    );
    assert.ok(
      out.mwr_period !== null && Math.abs(out.mwr_period - 0.1) < 1e-4,
      `expected mwr_period ≈ 0.10, got ${out.mwr_period}`,
    );
    assert.equal(out.cash_flows_breakdown.length, 2);
    assert.equal(out.cash_flows_breakdown[0]!.label, "INITIAL_NAV");
    assert.equal(out.cash_flows_breakdown[1]!.label, "TERMINAL_NAV");
    assert.ok(out.iterations > 0, "expected iterations > 0");
  } finally {
    cleanup();
  }
});

test("calculate_mwr: insufficient history (1 import) throws InsufficientHistoryError", async () => {
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
        await calculateMwr({}, { db });
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

test("calculate_mwr: non-convergence — NPV has no sign change in [-0.99, +10.0]", async () => {
  // Setup: a giant late APORTE swamps the terminal value so NPV is
  // negative across the entire bracket.
  //
  // Cash flow series (investor's perspective):
  //   INITIAL_NAV  -1000 on 2025-01-01
  //   APORTE     -10000 on 2025-12-31 (day 364)
  //   TERMINAL_NAV +1500 on 2026-01-01 (day 365)
  //
  // At r = -0.99 (lo): late flows blow up via 1/0.01^t.
  //   The APORTE at t≈1 contributes ≈ -10000/0.01 ≈ -1,000,000.
  //   The TERMINAL at t=1 contributes ≈ +150,000.
  //   Net dominated by APORTE → very negative.
  // At r = +10 (hi): everything discounted hard.
  //   INITIAL stays at -1000. APORTE ≈ -10000/11 ≈ -909.
  //   TERMINAL ≈ +1500/11 ≈ +136. Net ≈ -1773 → still negative.
  // No sign change → bisectIrr returns converged=false at iteration 0.
  const now = new Date("2026-02-01T12:00:00Z");
  const { db, cleanup } = withSeededDb((db) => {
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x1.pdf",
      totalRows: 1,
      declaredTotalCents: 100_000, // R$ 1,000
      referenceDate: "2025-01-01",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x2.pdf",
      totalRows: 1,
      declaredTotalCents: 150_000, // R$ 1,500
      referenceDate: "2026-01-01",
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
          flow_datetime: "2025-12-31 10:00:00",
          flow_date: "2025-12-31",
          kind: "APORTE",
          amount_cents: 1_000_000, // R$ 10,000 — huge vs initial 1,000
          description: "Giant late aporte",
        },
      ],
      cashImportId,
    );
  });
  try {
    const out = await calculateMwr({}, { db, now });
    assert.equal(out.converged, false, "expected converged=false");
    assert.equal(out.mwr_period, null, "expected mwr_period=null");
    assert.equal(out.mwr_annualized, null, "expected mwr_annualized=null");
    assert.equal(out.npv_at_solution, null, "expected npv_at_solution=null");
    assert.ok(
      out.warnings.some((w) => w.includes("MWR bisection did not converge")),
      `expected non-convergence warning, got: ${JSON.stringify(out.warnings)}`,
    );
    // Sanity: the breakdown still includes synthetic NAV markers + the flow.
    assert.equal(out.cash_flows_breakdown.length, 3);
    assert.equal(out.cash_flows_breakdown[0]!.label, "INITIAL_NAV");
    assert.equal(out.cash_flows_breakdown[1]!.label, "APORTE");
    assert.equal(out.cash_flows_breakdown[2]!.label, "TERMINAL_NAV");
  } finally {
    cleanup();
  }
});

test("calculate_mwr: period_from + period_to clamp the snapshot window", async () => {
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
    const out = await calculateMwr(
      { period_from: "2025-12-01", period_to: "2026-05-15" },
      { db, now },
    );
    assert.equal(out.snapshots_used, 2);
    assert.equal(out.period_from, "2026-01-01");
    assert.equal(out.period_to, "2026-05-01");
    assert.equal(out.cash_flows_breakdown.length, 2);
    assert.equal(out.cash_flows_breakdown[0]!.label, "INITIAL_NAV");
    assert.equal(out.cash_flows_breakdown[1]!.label, "TERMINAL_NAV");
  } finally {
    cleanup();
  }
});
