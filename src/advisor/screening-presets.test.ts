import { test } from "node:test";
import assert from "node:assert/strict";
import { criteriaFor } from "./screening-presets.js";

test("criteriaFor: income × FII", () => {
  const c = criteriaFor("income", "FII", 3);
  assert.equal(c.sort_by, "dividend_yield");
  assert.equal(c.order, "desc");
  assert.equal(c.limit, 3);
  assert.deepEqual(c.filters, {
    min_dividend_yield_pct: 6,
    max_pvp: 1.5,
    max_vacancy_pct: 15,
    min_market_cap_brl: 200_000_000,
  });
});

test("criteriaFor: income × ACAO", () => {
  const c = criteriaFor("income", "ACAO", 3);
  assert.equal(c.sort_by, "dividend_yield");
  assert.equal(c.order, "desc");
  assert.deepEqual(c.filters, {
    min_dividend_yield_pct: 4,
    min_market_cap_brl: 1_000_000_000,
  });
});

test("criteriaFor: income × ETF", () => {
  const c = criteriaFor("income", "ETF", 3);
  assert.equal(c.sort_by, "dividend_yield");
  assert.deepEqual(c.filters, {
    min_dividend_yield_pct: 3,
    min_market_cap_brl: 100_000_000,
  });
});

test("criteriaFor: growth × FII", () => {
  const c = criteriaFor("growth", "FII", 3);
  assert.equal(c.sort_by, "market_cap");
  assert.deepEqual(c.filters, {
    min_market_cap_brl: 500_000_000,
    max_pvp: 1.2,
  });
});

test("criteriaFor: growth × ACAO", () => {
  const c = criteriaFor("growth", "ACAO", 3);
  assert.equal(c.sort_by, "roe");
  assert.deepEqual(c.filters, {
    min_roe_pct: 10,
    min_market_cap_brl: 1_000_000_000,
  });
});

test("criteriaFor: growth × ETF", () => {
  const c = criteriaFor("growth", "ETF", 3);
  assert.equal(c.sort_by, "price_change_30d");
  assert.deepEqual(c.filters, {
    min_market_cap_brl: 500_000_000,
  });
});

test("criteriaFor: balanced × FII", () => {
  const c = criteriaFor("balanced", "FII", 3);
  assert.equal(c.sort_by, "dividend_yield");
  assert.deepEqual(c.filters, {
    min_dividend_yield_pct: 4,
    max_pvp: 1.3,
    min_market_cap_brl: 300_000_000,
  });
});

test("criteriaFor: balanced × ACAO", () => {
  const c = criteriaFor("balanced", "ACAO", 3);
  assert.equal(c.sort_by, "roe");
  assert.deepEqual(c.filters, {
    min_roe_pct: 5,
    min_market_cap_brl: 500_000_000,
    min_dividend_yield_pct: 2,
  });
});

test("criteriaFor: balanced × ETF", () => {
  const c = criteriaFor("balanced", "ETF", 3);
  assert.equal(c.sort_by, "market_cap");
  assert.deepEqual(c.filters, {
    min_market_cap_brl: 500_000_000,
  });
});

test("criteriaFor: top_n forwards to limit verbatim", () => {
  for (const n of [1, 2, 3, 4, 5]) {
    assert.equal(criteriaFor("income", "FII", n).limit, n);
  }
});

test("criteriaFor: order defaults to 'desc' for every cell", () => {
  const objectives = ["income", "growth", "balanced"] as const;
  const classes = ["FII", "ACAO", "ETF"] as const;
  for (const o of objectives) {
    for (const cls of classes) {
      assert.equal(criteriaFor(o, cls, 3).order, "desc");
    }
  }
});

test("criteriaFor: pure (same input → same output)", () => {
  const a = criteriaFor("income", "FII", 3);
  const b = criteriaFor("income", "FII", 3);
  assert.deepEqual(a, b);
  assert.notStrictEqual(a, b); // distinct objects (no shared mutable state)
});
