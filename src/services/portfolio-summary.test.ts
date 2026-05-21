import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateByClass } from "./portfolio-summary.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AssetClass } from "../storage/schema.js";
import { computeReconciliation } from "./portfolio-summary.js";
import type { LastDeclaredImport } from "../storage/imports-repo.js";

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
