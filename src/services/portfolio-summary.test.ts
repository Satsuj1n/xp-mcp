import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateByClass } from "./portfolio-summary.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AssetClass } from "../storage/schema.js";

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
