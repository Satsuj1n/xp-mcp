import { test } from "node:test";
import assert from "node:assert/strict";
import { screen, type ScreenInput } from "./screening.js";
import type { Fundamentals, Quote } from "./market-data/source.js";

function q(ticker: string, price = 10, marketCap = 1_000_000_000): Quote {
  return {
    ticker,
    price_brl: price,
    change_pct: 0,
    volume: 1000,
    market_cap_brl: marketCap,
    updated_at: "2026-05-20T00:00:00.000Z",
  };
}

function f(ticker: string, fields: Partial<Fundamentals> = {}): Fundamentals {
  return {
    ticker,
    dividend_yield_pct: null,
    pl_ratio: null,
    pvp_ratio: null,
    roe_pct: null,
    vacancy_pct: null,
    updated_at: "2026-05-20T00:00:00.000Z",
    ...fields,
  };
}

test("sorts by dividend_yield desc and limits to N", () => {
  const input: ScreenInput = {
    candidates: [
      {
        ticker: "A",
        quote: q("A"),
        fundamentals: f("A", { dividend_yield_pct: 8 }),
      },
      {
        ticker: "B",
        quote: q("B"),
        fundamentals: f("B", { dividend_yield_pct: 12 }),
      },
      {
        ticker: "C",
        quote: q("C"),
        fundamentals: f("C", { dividend_yield_pct: 10 }),
      },
    ],
    criteria: {
      sort_by: "dividend_yield",
      order: "desc",
      filters: {},
      limit: 2,
    },
    excluded_tickers: [],
  };
  const out = screen(input);
  assert.deepEqual(
    out.map((r) => r.ticker),
    ["B", "C"],
  );
});

test("filters out candidates below min_dividend_yield_pct", () => {
  const input: ScreenInput = {
    candidates: [
      {
        ticker: "A",
        quote: q("A"),
        fundamentals: f("A", { dividend_yield_pct: 5 }),
      },
      {
        ticker: "B",
        quote: q("B"),
        fundamentals: f("B", { dividend_yield_pct: 11 }),
      },
    ],
    criteria: {
      sort_by: "dividend_yield",
      order: "desc",
      filters: { min_dividend_yield_pct: 8 },
      limit: 5,
    },
    excluded_tickers: [],
  };
  const out = screen(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].ticker, "B");
});

test("respects excluded_tickers", () => {
  const input: ScreenInput = {
    candidates: [
      {
        ticker: "A",
        quote: q("A"),
        fundamentals: f("A", { dividend_yield_pct: 10 }),
      },
      {
        ticker: "B",
        quote: q("B"),
        fundamentals: f("B", { dividend_yield_pct: 9 }),
      },
    ],
    criteria: {
      sort_by: "dividend_yield",
      order: "desc",
      filters: {},
      limit: 5,
    },
    excluded_tickers: ["A"],
  };
  const out = screen(input);
  assert.deepEqual(
    out.map((r) => r.ticker),
    ["B"],
  );
});

test("sorts nulls last when sort field is missing", () => {
  const input: ScreenInput = {
    candidates: [
      {
        ticker: "A",
        quote: q("A"),
        fundamentals: f("A", { dividend_yield_pct: null }),
      },
      {
        ticker: "B",
        quote: q("B"),
        fundamentals: f("B", { dividend_yield_pct: 7 }),
      },
    ],
    criteria: {
      sort_by: "dividend_yield",
      order: "desc",
      filters: {},
      limit: 5,
    },
    excluded_tickers: [],
  };
  const out = screen(input);
  assert.equal(out[0].ticker, "B");
  assert.equal(out[1].ticker, "A");
  assert.equal(out[1].score, 0);
});

test("score is normalized 0..1 across returned population", () => {
  const input: ScreenInput = {
    candidates: [
      {
        ticker: "A",
        quote: q("A"),
        fundamentals: f("A", { dividend_yield_pct: 5 }),
      },
      {
        ticker: "B",
        quote: q("B"),
        fundamentals: f("B", { dividend_yield_pct: 10 }),
      },
      {
        ticker: "C",
        quote: q("C"),
        fundamentals: f("C", { dividend_yield_pct: 15 }),
      },
    ],
    criteria: {
      sort_by: "dividend_yield",
      order: "desc",
      filters: {},
      limit: 5,
    },
    excluded_tickers: [],
  };
  const out = screen(input);
  assert.equal(out[0].score, 1);
  assert.equal(out[out.length - 1].score, 0);
});

test("why describes rank vs median", () => {
  const input: ScreenInput = {
    candidates: [
      {
        ticker: "A",
        quote: q("A"),
        fundamentals: f("A", { dividend_yield_pct: 5 }),
      },
      {
        ticker: "B",
        quote: q("B"),
        fundamentals: f("B", { dividend_yield_pct: 10 }),
      },
      {
        ticker: "C",
        quote: q("C"),
        fundamentals: f("C", { dividend_yield_pct: 15 }),
      },
    ],
    criteria: {
      sort_by: "dividend_yield",
      order: "desc",
      filters: {},
      limit: 5,
    },
    excluded_tickers: [],
  };
  const out = screen(input);
  assert.match(out[0].why, /DY 15(\.0+)?% .*median 10/);
});

test("deterministic: same input yields same output", () => {
  const input: ScreenInput = {
    candidates: [
      { ticker: "A", quote: q("A"), fundamentals: f("A", { pvp_ratio: 1.2 }) },
      { ticker: "B", quote: q("B"), fundamentals: f("B", { pvp_ratio: 0.8 }) },
    ],
    criteria: { sort_by: "pvp", order: "asc", filters: {}, limit: 5 },
    excluded_tickers: [],
  };
  assert.deepEqual(screen(input), screen(input));
});

test("max_pvp filter rejects candidates above threshold", () => {
  const input: ScreenInput = {
    candidates: [
      { ticker: "A", quote: q("A"), fundamentals: f("A", { pvp_ratio: 1.5 }) },
      { ticker: "B", quote: q("B"), fundamentals: f("B", { pvp_ratio: 0.9 }) },
    ],
    criteria: {
      sort_by: "pvp",
      order: "asc",
      filters: { max_pvp: 1.0 },
      limit: 5,
    },
    excluded_tickers: [],
  };
  const out = screen(input);
  assert.deepEqual(
    out.map((r) => r.ticker),
    ["B"],
  );
});
