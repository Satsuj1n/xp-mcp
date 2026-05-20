import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDrift } from "./drift.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AssetClass } from "../storage/schema.js";
import type { AllocationTarget } from "../parsers/allocation-target.js";

function mkPosition(
  cls: AssetClass,
  marketCents: number | null,
  importedAt = "2026-05-12 00:00:00",
): PositionRow {
  return {
    id: 1,
    asset_class: cls,
    external_id: `${cls}_TEST`,
    name: cls,
    quantity: 1,
    avg_price_cents: null,
    current_price_cents: null,
    invested_cents: null,
    market_value_cents: marketCents,
    issuer: null,
    indexer: null,
    rate: null,
    maturity_date: null,
    has_fgc: null,
    last_imported_at: importedAt,
  };
}

function mkTarget(
  allocation: Partial<Record<AssetClass, number>>,
  tolerance_pp: number | null = null,
): AllocationTarget {
  return {
    target_allocation: allocation,
    tolerance_pp,
    source_path: "/fake/allocation.json",
  };
}

test("empty positions → drift=[], total=0, no-positions warning", () => {
  const r = computeDrift([], mkTarget({ TESOURO: 1.0 }));
  assert.equal(r.total_brl, 0);
  assert.deepEqual(r.drift, []);
  assert.ok(r.warnings.some((w) => w.includes("No positions")));
});

test("drift=0 with no tolerance → status='ok' (zero is within tolerance=0)", () => {
  const positions = [mkPosition("TESOURO", 100_000)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  assert.equal(r.drift.length, 1);
  assert.equal(r.drift[0].status, "ok");
  assert.equal(r.drift[0].action, null);
  assert.equal(r.drift[0].drift_pp, 0);
});

test("overweight with tolerance band → SELL with exact amount", () => {
  // Total 1000 = TESOURO 600 + FII 400. Target 50/50.
  // TESOURO 60% vs 50% → drift +10pp, > tolerance 2 → SELL 100
  const positions = [mkPosition("TESOURO", 60_000), mkPosition("FII", 40_000)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }, 2.0));
  const tesouro = r.drift.find((d) => d.asset_class === "TESOURO");
  assert.ok(tesouro);
  assert.equal(tesouro.status, "overweight");
  assert.deepEqual(tesouro.action, { side: "SELL", amount_brl: 100 });
});

test("underweight → BUY", () => {
  const positions = [mkPosition("TESOURO", 40_000), mkPosition("FII", 60_000)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }));
  const tesouro = r.drift.find((d) => d.asset_class === "TESOURO");
  assert.ok(tesouro);
  assert.equal(tesouro.status, "underweight");
  assert.deepEqual(tesouro.action, { side: "BUY", amount_brl: 100 });
});

test("class in target but absent from positions → BUY of target_brl", () => {
  const positions = [mkPosition("TESOURO", 100_000)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, ETF: 0.5 }));
  const etf = r.drift.find((d) => d.asset_class === "ETF");
  assert.ok(etf);
  assert.equal(etf.current_brl, 0);
  assert.equal(etf.target_brl, 500);
  assert.deepEqual(etf.action, { side: "BUY", amount_brl: 500 });
});

test("class in positions but absent from target → SELL full amount", () => {
  const positions = [
    mkPosition("TESOURO", 50_000),
    mkPosition("FUNDO", 50_000),
  ];
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  const fundo = r.drift.find((d) => d.asset_class === "FUNDO");
  assert.ok(fundo);
  assert.equal(fundo.target_pct, 0);
  assert.equal(fundo.target_brl, 0);
  assert.equal(fundo.status, "overweight");
  assert.deepEqual(fundo.action, { side: "SELL", amount_brl: 500 });
});

test("class with current=0 AND target=0 is filtered out", () => {
  const positions = [mkPosition("TESOURO", 100_000)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  assert.equal(r.drift.length, 1);
  assert.equal(r.drift[0].asset_class, "TESOURO");
});

test("tolerance band: drift within → ok, action=null", () => {
  // 51.5% vs 50% → 1.5pp, within tolerance 2 → ok
  const positions = [mkPosition("TESOURO", 51_500), mkPosition("FII", 48_500)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }, 2.0));
  for (const row of r.drift) {
    assert.equal(row.status, "ok");
    assert.equal(row.action, null);
  }
});

test("tolerance band: drift just outside → action present", () => {
  // 52.5% vs 50% → 2.5pp > tolerance 2 → overweight
  const positions = [mkPosition("TESOURO", 52_500), mkPosition("FII", 47_500)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }, 2.0));
  const tesouro = r.drift.find((d) => d.asset_class === "TESOURO");
  assert.ok(tesouro);
  assert.equal(tesouro.status, "overweight");
  assert.deepEqual(tesouro.action, { side: "SELL", amount_brl: 25 });
});

test("rebalance_net_brl ≈ 0 across multi-class fixture", () => {
  const positions = [mkPosition("TESOURO", 60_000), mkPosition("FII", 40_000)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }));
  assert.ok(Math.abs(r.rebalance_net_brl) <= 0.02);
});

test("ordering: rows sorted by |drift_pp| descending", () => {
  // TESOURO 80% vs 50% → +30; FII 10% vs 30% → -20; ACAO 10% vs 20% → -10
  const positions = [
    mkPosition("TESOURO", 80_000),
    mkPosition("FII", 10_000),
    mkPosition("ACAO", 10_000),
  ];
  const r = computeDrift(
    positions,
    mkTarget({ TESOURO: 0.5, FII: 0.3, ACAO: 0.2 }),
  );
  assert.equal(r.drift[0].asset_class, "TESOURO");
  assert.equal(r.drift[1].asset_class, "FII");
  assert.equal(r.drift[2].asset_class, "ACAO");
});

test("position with null market_value_cents is skipped and warned", () => {
  const positions = [mkPosition("TESOURO", 100_000), mkPosition("FII", null)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  assert.ok(
    r.warnings.some((w) => w.includes("1 position") && w.includes("skipped")),
  );
});

test("reference_date is the max last_imported_at across positions", () => {
  const positions = [
    mkPosition("TESOURO", 67_000, "2026-05-10 00:00:00"),
    mkPosition("FII", 33_000, "2026-05-15 00:00:00"),
  ];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.67, FII: 0.33 }));
  assert.equal(r.reference_date, "2026-05-15 00:00:00");
});
