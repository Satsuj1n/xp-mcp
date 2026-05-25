import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateByClass } from "./portfolio-summary.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AssetClass } from "../storage/schema.js";
import { computeReconciliation } from "./portfolio-summary.js";
import type { LastDeclaredImport } from "../storage/imports-repo.js";
import type { CashFlowSummary } from "./cash-flow-summary.js";

function mkCashFlowSummary(
  overrides: Partial<CashFlowSummary> = {},
): CashFlowSummary {
  return {
    as_of_date: "2026-05-24",
    total_records: 0,
    ytd: {
      year: 2026,
      aporte_brl: 0,
      resgate_brl: 0,
      net_brl: 0,
    },
    rolling_12m: {
      from_month: "2025-06",
      to_month: "2026-05",
      months_with_data: 0,
      aporte_brl: 0,
      resgate_brl: 0,
      net_brl: 0,
      monthly_avg_aporte_brl: 0,
      monthly_avg_net_brl: 0,
    },
    ...overrides,
  };
}

function mkPosition(
  cls: AssetClass,
  marketCents: number | null,
  investedCents: number | null = null,
  externalId = `${cls}_X`,
): PositionRow {
  return {
    id: 1,
    asset_class: cls,
    external_id: externalId,
    name: cls,
    quantity: 1,
    avg_price_cents: null,
    current_price_cents: null,
    invested_cents: investedCents,
    market_value_cents: marketCents,
    issuer: null,
    indexer: null,
    rate: null,
    maturity_date: null,
    has_fgc: null,
    last_imported_at: "2026-05-21 10:00:00",
  };
}

test("aggregateByClass: single class single position", () => {
  const out = aggregateByClass([mkPosition("FII", 100000)]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.asset_class, "FII");
  assert.equal(out[0]!.count, 1);
  assert.equal(out[0]!.market_value_brl, 1000);
  assert.equal(out[0]!.pct_of_total, 1);
  assert.equal(out[0]!.invested_brl, null);
  assert.equal(out[0]!.unrealized_pl_brl, null);
  assert.equal(out[0]!.unrealized_pl_pct, null);
});

test("aggregateByClass: multiple classes sorted by market_value desc", () => {
  const out = aggregateByClass([
    mkPosition("ACAO", 200000),
    mkPosition("FII", 500000),
    mkPosition("ETF", 100000),
  ]);
  assert.deepEqual(
    out.map((r) => r.asset_class),
    ["FII", "ACAO", "ETF"],
  );
  assert.deepEqual(
    out.map((r) => r.market_value_brl),
    [5000, 2000, 1000],
  );
});

test("aggregateByClass: pct_of_total sums to 1 (within FP tolerance)", () => {
  const out = aggregateByClass([
    mkPosition("FII", 100000),
    mkPosition("ACAO", 200000),
    mkPosition("ETF", 300000),
  ]);
  const sum = out.reduce((s, r) => s + r.pct_of_total, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `sum was ${sum}`);
});

test("aggregateByClass: per-class P&L computed over subset with invested", () => {
  const out = aggregateByClass([
    mkPosition("FII", 100000, 80000, "F1"), // invested 800, market 1000 → PL 200
    mkPosition("FII", 50000, null, "F2"), // no invested
  ]);
  const fii = out.find((r) => r.asset_class === "FII")!;
  assert.equal(fii.invested_brl, 800);
  assert.equal(fii.unrealized_pl_brl, 200); // 1000 - 800 (over the SUBSET with invested)
  assert.equal(fii.unrealized_pl_pct, 0.25);
});

test("aggregateByClass: class with zero positions having invested → P&L all null", () => {
  const out = aggregateByClass([
    mkPosition("TESOURO", 100000, null),
    mkPosition("TESOURO", 200000, null),
  ]);
  assert.equal(out[0]!.invested_brl, null);
  assert.equal(out[0]!.unrealized_pl_brl, null);
  assert.equal(out[0]!.unrealized_pl_pct, null);
});

import { pickTopPositions } from "./portfolio-summary.js";

test("pickTopPositions: returns top n sorted by market_value desc", () => {
  const positions = [
    mkPosition("FII", 100000, null, "A"),
    mkPosition("ACAO", 300000, null, "B"),
    mkPosition("ETF", 200000, null, "C"),
  ];
  const out = pickTopPositions(positions, 2, 600000);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.external_id, "B");
  assert.equal(out[0]!.market_value_brl, 3000);
  assert.equal(out[0]!.pct_of_total, 0.5);
  assert.equal(out[1]!.external_id, "C");
});

test("pickTopPositions: returns fewer than n when positions are fewer", () => {
  const out = pickTopPositions([mkPosition("FII", 100000)], 5, 100000);
  assert.equal(out.length, 1);
});

test("pickTopPositions: ties broken by external_id asc (deterministic)", () => {
  const out = pickTopPositions(
    [
      mkPosition("FII", 100000, null, "Z"),
      mkPosition("FII", 100000, null, "A"),
      mkPosition("FII", 100000, null, "M"),
    ],
    3,
    300000,
  );
  assert.deepEqual(
    out.map((p) => p.external_id),
    ["A", "M", "Z"],
  );
});

const declared: LastDeclaredImport = {
  id: 1,
  declared_total_cents: 3125000,
  reference_date: "2026-05-21",
  source_path: "/tmp/x.pdf",
  imported_at: "2026-05-21 10:00:00",
};

test("computeReconciliation: returns null when lastDecl is null", () => {
  assert.equal(
    computeReconciliation(3000000, "2026-05-21T10:00:00", null),
    null,
  );
});

test("computeReconciliation: fresh declared (same date) is not stale", () => {
  const r = computeReconciliation(3123666, "2026-05-21T10:00:00", declared);
  assert.ok(r);
  assert.equal(r!.is_stale, false);
});

test("computeReconciliation: declared older than computed_as_of is stale", () => {
  const olderDeclared = { ...declared, reference_date: "2026-05-13" };
  const r = computeReconciliation(
    3000000,
    "2026-05-21T10:00:00",
    olderDeclared,
  );
  assert.equal(r!.is_stale, true);
});

test("computeReconciliation: gap zero", () => {
  const r = computeReconciliation(3125000, "2026-05-21T10:00:00", declared);
  assert.equal(r!.gap_brl, 0);
  assert.equal(r!.gap_pct, 0);
});

test("computeReconciliation: gap negative (computed < declared)", () => {
  const r = computeReconciliation(3000000, "2026-05-21T10:00:00", declared);
  assert.equal(r!.computed_total_brl, 30000);
  assert.equal(r!.declared_total_brl, 31250);
  assert.equal(r!.gap_brl, -1250);
  assert.ok(r!.gap_pct < 0);
});

test("computeReconciliation: gap positive (computed > declared)", () => {
  const r = computeReconciliation(3200000, "2026-05-21T10:00:00", declared);
  assert.equal(r!.gap_brl, 750);
  assert.ok(r!.gap_pct > 0);
});

import { computeFgcCoverage } from "./portfolio-summary.js";

function mkFgcPos(cls: AssetClass, mv: number, fgc: 0 | 1 | null): PositionRow {
  return { ...mkPosition(cls, mv), has_fgc: fgc };
}

test("computeFgcCoverage: all covered", () => {
  const out = computeFgcCoverage(
    [
      mkFgcPos("RENDA_FIXA_PRIVADA", 100000, 1),
      mkFgcPos("RENDA_FIXA_PRIVADA", 200000, 1),
    ],
    300000,
  );
  assert.equal(out.covered_brl, 3000);
  assert.equal(out.not_covered_brl, 0);
  assert.equal(out.unknown_brl, 0);
  assert.equal(out.covered_pct, 1);
});

test("computeFgcCoverage: mixed", () => {
  const out = computeFgcCoverage(
    [
      mkFgcPos("RENDA_FIXA_PRIVADA", 100000, 1),
      mkFgcPos("TESOURO", 200000, 0),
      mkFgcPos("ACAO", 300000, null),
    ],
    600000,
  );
  assert.equal(out.covered_brl, 1000);
  assert.equal(out.not_covered_brl, 2000);
  assert.equal(out.unknown_brl, 3000);
  assert.ok(Math.abs(out.covered_pct - 1000 / 6000) < 1e-9);
});

test("computeFgcCoverage: total zero → covered_pct = 0", () => {
  const out = computeFgcCoverage([], 0);
  assert.equal(out.covered_pct, 0);
});

import { computeMaturityBuckets } from "./portfolio-summary.js";

function mkMatPos(
  mv: number,
  maturity: string | null,
  cls: AssetClass = "RENDA_FIXA_PRIVADA",
): PositionRow {
  return { ...mkPosition(cls, mv), maturity_date: maturity };
}

test("computeMaturityBuckets: short (<1y), medium (1-3y), long (>3y), no_maturity", () => {
  const horizon = "2026-05-21";
  const out = computeMaturityBuckets(
    [
      mkMatPos(100000, "2026-08-15"), // ~3 months → short
      mkMatPos(200000, "2027-08-15"), // ~15 months → medium
      mkMatPos(300000, "2030-08-15"), // >3 years → long
      mkMatPos(400000, null, "ACAO"), // no_maturity
    ],
    horizon,
  );
  assert.equal(out.short_brl, 1000);
  assert.equal(out.medium_brl, 2000);
  assert.equal(out.long_brl, 3000);
  assert.equal(out.no_maturity_brl, 4000);
  assert.equal(out.short_count, 1);
  assert.equal(out.medium_count, 1);
  assert.equal(out.long_count, 1);
  assert.equal(out.no_maturity_count, 1);
  assert.equal(out.horizon_from, "2026-05-21");
});

test("computeMaturityBuckets: past maturity → short bucket + past_count", () => {
  const out = computeMaturityBuckets(
    [mkMatPos(100000, "2025-01-01")],
    "2026-05-21",
  );
  assert.equal(out.short_brl, 1000);
  assert.equal(out.short_count, 1);
  assert.equal(out.past_count, 1);
  assert.equal(out.malformed_count, 0);
});

test("computeMaturityBuckets: malformed maturity → no_maturity bucket + malformed_count", () => {
  const out = computeMaturityBuckets(
    [mkMatPos(100000, "not-a-date")],
    "2026-05-21",
  );
  assert.equal(out.no_maturity_brl, 1000);
  assert.equal(out.no_maturity_count, 1);
  assert.equal(out.malformed_count, 1);
  assert.equal(out.past_count, 0);
});

test("computeMaturityBuckets: null maturity does NOT count as malformed", () => {
  const out = computeMaturityBuckets(
    [mkMatPos(100000, null, "ACAO")],
    "2026-05-21",
  );
  assert.equal(out.no_maturity_count, 1);
  assert.equal(out.malformed_count, 0);
  assert.equal(out.past_count, 0);
});

test("computeMaturityBuckets: mixed past + malformed + future short", () => {
  const out = computeMaturityBuckets(
    [
      mkMatPos(100000, "2025-01-01"), // past → short + past_count
      mkMatPos(200000, "not-a-date"), // malformed → no_maturity + malformed_count
      mkMatPos(300000, "2026-08-15"), // future short, not past
    ],
    "2026-05-21",
  );
  assert.equal(out.short_count, 2); // past + future-short
  assert.equal(out.past_count, 1);
  assert.equal(out.no_maturity_count, 1);
  assert.equal(out.malformed_count, 1);
});

test("computeMaturityBuckets: empty positions → all zeros", () => {
  const out = computeMaturityBuckets([], "2026-05-21");
  assert.equal(out.short_brl, 0);
  assert.equal(out.medium_brl, 0);
  assert.equal(out.long_brl, 0);
  assert.equal(out.no_maturity_brl, 0);
});

test("computeMaturityBuckets: exactly-at-boundary edge cases", () => {
  // 365 days exact = medium (not short)
  // 365*3 = 1095 days = long (not medium)
  const out = computeMaturityBuckets(
    [
      mkMatPos(100000, "2027-05-21"), // exactly 365 days → medium
      mkMatPos(200000, "2029-05-21"), // exactly 3y (1095 days) → long
    ],
    "2026-05-21",
  );
  assert.equal(out.medium_count, 1);
  assert.equal(out.long_count, 1);
});

import { computePortfolioSummary } from "./portfolio-summary.js";

test("computePortfolioSummary: empty DB returns empty-state summary with warning", () => {
  const out = computePortfolioSummary([], null, null);
  assert.equal(out.total_market_value_brl, 0);
  assert.equal(out.positions_count, 0);
  assert.deepEqual(out.by_class, []);
  assert.deepEqual(out.top_positions, []);
  assert.equal(out.reconciliation, null);
  assert.equal(out.cash_flow_summary, null);
  assert.ok(out.warnings.some((w) => w.includes("No positions in database")));
});

test("computePortfolioSummary: empty DB with declared import → reconciliation non-null, gap is negative declared", () => {
  // Edge case: user had XPerformance imported before, then positions were
  // wiped (e.g. fresh re-import in progress). Reconciliation must still
  // surface the declared value vs computed=0 so the LLM can flag it.
  const declared: LastDeclaredImport = {
    id: 1,
    declared_total_cents: 500000,
    reference_date: "2026-05-21",
    source_path: "/tmp/x.pdf",
    imported_at: "2026-05-21 10:00:00",
  };
  const out = computePortfolioSummary([], declared, null);
  assert.equal(out.positions_count, 0);
  assert.equal(out.total_market_value_brl, 0);
  assert.ok(out.reconciliation);
  assert.equal(out.reconciliation!.declared_total_brl, 5000);
  assert.equal(out.reconciliation!.computed_total_brl, 0);
  assert.equal(out.reconciliation!.gap_brl, -5000);
  assert.equal(out.reconciliation!.gap_pct, -1);
  assert.equal(out.cash_flow_summary, null);
  assert.ok(out.warnings.some((w) => w.includes("No positions in database")));
});

test("computePortfolioSummary: full portfolio with declared import", () => {
  const positions: PositionRow[] = [
    {
      ...mkPosition("TESOURO", 1500000),
      maturity_date: "2031-01-01",
      has_fgc: 0,
    },
    {
      ...mkPosition("FII", 500000, 450000, "MXRF11"),
      maturity_date: null,
      has_fgc: null,
    },
    {
      ...mkPosition("RENDA_FIXA_PRIVADA", 200000, 180000, "CDB1"),
      maturity_date: "2026-08-15",
      has_fgc: 1,
    },
  ];
  const declared: LastDeclaredImport = {
    id: 1,
    declared_total_cents: 2200000,
    reference_date: "2026-05-21",
    source_path: "/tmp/x.pdf",
    imported_at: "2026-05-21 10:00:00",
  };
  const out = computePortfolioSummary(positions, declared, null);
  assert.equal(out.total_market_value_brl, 22000);
  assert.equal(out.positions_count, 3);
  assert.equal(out.by_class.length, 3);
  assert.equal(out.by_class[0]!.asset_class, "TESOURO"); // sorted by mv desc
  assert.equal(out.top_positions.length, 3);
  assert.equal(out.fgc_coverage.covered_brl, 2000);
  assert.equal(out.maturity_buckets.no_maturity_brl, 5000);
  assert.ok(out.reconciliation);
  assert.equal(out.reconciliation!.gap_brl, 0);
  // P&L coverage: 2 of 3 positions have invested → total_invested = 450+180 = 630
  assert.equal(out.pl_coverage.positions_with_pl_count, 2);
  assert.equal(out.pl_coverage.positions_total, 3);
  assert.equal(out.total_invested_brl, 6300);
  assert.equal(out.cash_flow_summary, null);
});

test("computePortfolioSummary: positions without market_value are filtered with warning", () => {
  const out = computePortfolioSummary(
    [mkPosition("FII", 100000), mkPosition("ACAO", null)],
    null,
    null,
  );
  assert.equal(out.positions_count, 1);
  assert.ok(out.warnings.some((w) => w.includes("skipped")));
});

test("computePortfolioSummary: no declared import emits warning when positions exist", () => {
  const out = computePortfolioSummary([mkPosition("FII", 100000)], null, null);
  assert.ok(
    out.warnings.some((w) => w.includes("No XPerformance PDF imported yet")),
  );
});

test("computePortfolioSummary: stale declared emits stale warning", () => {
  const stale: LastDeclaredImport = {
    id: 1,
    declared_total_cents: 100000,
    reference_date: "2026-05-01",
    source_path: "/tmp/x.pdf",
    imported_at: "2026-05-01 10:00:00",
  };
  const positions = [
    {
      ...mkPosition("FII", 100000),
      last_imported_at: "2026-05-21 10:00:00",
    },
  ];
  const out = computePortfolioSummary(positions, stale, null);
  assert.equal(out.reconciliation!.is_stale, true);
  assert.ok(out.warnings.some((w) => w.includes("Declared total dates from")));
});

test("computePortfolioSummary: large gap (>1%) emits warning", () => {
  const declared: LastDeclaredImport = {
    id: 1,
    declared_total_cents: 1000000,
    reference_date: "2026-05-21",
    source_path: "/tmp/x.pdf",
    imported_at: "2026-05-21 10:00:00",
  };
  const positions = [
    {
      ...mkPosition("FII", 800000),
      last_imported_at: "2026-05-21 10:00:00",
    },
  ];
  const out = computePortfolioSummary(positions, declared, null);
  assert.ok(out.warnings.some((w) => w.includes("Reconciliation gap")));
});

test("computePortfolioSummary: cash_flow_summary attached when non-null, no warning", () => {
  const cfs = mkCashFlowSummary({
    total_records: 2,
    ytd: { year: 2026, aporte_brl: 1500, resgate_brl: 0, net_brl: 1500 },
  });
  const out = computePortfolioSummary([mkPosition("FII", 100000)], null, cfs);
  assert.equal(out.cash_flow_summary, cfs);
  assert.ok(
    !out.warnings.some((w) => w.includes("No cash flows imported yet")),
    `expected no "No cash flows imported yet" warning, got: ${JSON.stringify(out.warnings)}`,
  );
});

test("computePortfolioSummary: warning when cashFlowSummary is null AND positions exist", () => {
  const out = computePortfolioSummary([mkPosition("FII", 100000)], null, null);
  assert.equal(out.cash_flow_summary, null);
  assert.ok(
    out.warnings.some((w) =>
      w.includes("No cash flows imported yet; cash_flow_summary unavailable"),
    ),
    `expected "No cash flows imported yet" warning, got: ${JSON.stringify(out.warnings)}`,
  );
});

// v0.12 — crypto as a tracked asset_class. A CRIPTO position carries no cost
// basis (invested_cents null), so it aggregates by class on market value only.
test("computePortfolioSummary: CRIPTO position aggregates as its own class with correct mv/pct", () => {
  const positions: PositionRow[] = [
    mkPosition("FII", 300000, null, "MXRF11"), // R$ 3,000
    // crypto snapshot: qty * price → market_value only, no invested/avg
    mkPosition("CRIPTO", 100000, null, "BTC"), // R$ 1,000
  ];
  const out = computePortfolioSummary(positions, null, null);

  assert.equal(out.total_market_value_brl, 4000);
  const cripto = out.by_class.find((r) => r.asset_class === "CRIPTO");
  assert.ok(cripto, "expected a CRIPTO line in by_class");
  assert.equal(cripto!.count, 1);
  assert.equal(cripto!.market_value_brl, 1000);
  assert.ok(Math.abs(cripto!.pct_of_total - 1000 / 4000) < 1e-9);
  // No cost basis → P&L fields stay null for the crypto class.
  assert.equal(cripto!.invested_brl, null);
  assert.equal(cripto!.unrealized_pl_brl, null);
  assert.equal(cripto!.unrealized_pl_pct, null);
});
