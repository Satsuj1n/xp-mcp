import { test } from "node:test";
import assert from "node:assert/strict";
import { composeSuggestions, type SuggestBuysResult } from "./suggest-buys.js";
import type { DriftReport } from "./drift.js";
import type { ScreenAssetsResult } from "../tools/screen-assets.js";

const DISCLAIMER =
  "[disclaimer] Análise educacional baseada em dados públicos. Não constitui recomendação de investimento. Decisões financeiras são de sua responsabilidade.";

function driftRow(
  cls: string,
  status: "ok" | "overweight" | "underweight",
  amount_brl?: number,
) {
  return {
    asset_class: cls as never,
    current_brl: 1000,
    current_pct: 0.1,
    target_pct: 0.15,
    target_brl: 1500,
    drift_pp: status === "underweight" ? -5 : status === "overweight" ? 5 : 0,
    status,
    action:
      status === "underweight"
        ? { side: "BUY" as const, amount_brl: amount_brl ?? 500 }
        : status === "overweight"
          ? { side: "SELL" as const, amount_brl: amount_brl ?? 500 }
          : null,
  };
}

function drift(rows: ReturnType<typeof driftRow>[]): DriftReport {
  return {
    total_brl: 10000,
    tolerance_pp: 0,
    target_path: "/tmp/alloc.json",
    reference_date: "2026-05-23",
    drift: rows,
    rebalance_net_brl: 0,
    warnings: [],
  };
}

function screenResult(
  cls: "FII" | "ACAO" | "ETF",
  tickers: Array<{ ticker: string; score: number; why: string }>,
  universe_size = 50,
): ScreenAssetsResult {
  return {
    ok: true,
    asset_class: cls,
    universe_size,
    filtered_size: tickers.length,
    returned: tickers.length,
    results: tickers.map((t) => ({
      ticker: t.ticker,
      score: t.score,
      why: t.why,
      quote: {} as never,
      fundamentals: {} as never,
    })),
    warnings: [DISCLAIMER],
  };
}

test("composeSuggestions: single underweight FII class, top_n=3", () => {
  const d = drift([driftRow("FII", "underweight", 1800)]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [
        { ticker: "MXRF11", score: 1.0, why: "DY 11% (median 9%)" },
        { ticker: "HGLG11", score: 0.7, why: "DY 10% (median 9%)" },
        { ticker: "KNCR11", score: 0.3, why: "DY 9.5% (median 9%)" },
      ]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.suggestions.length, 3);
  assert.equal(r.suggestions[0]?.asset_class, "FII");
  assert.equal(r.suggestions[0]?.ticker, "MXRF11");
  assert.equal(r.suggestions[0]?.amount_brl, 600); // 1800 / 3
  assert.equal(r.suggestions[0]?.already_owned, false);
  assert.equal(r.total_to_invest_brl, 1800);
  assert.equal(r.total_skipped_brl, 0);
  assert.equal(r.skipped_classes.length, 0);
  assert.equal(r.warnings[0], DISCLAIMER);
});

test("composeSuggestions: multiple screenable underweight classes", () => {
  const d = drift([
    driftRow("FII", "underweight", 900),
    driftRow("ACAO", "underweight", 600),
  ]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [
        { ticker: "MXRF11", score: 1.0, why: "DY 11%" },
        { ticker: "HGLG11", score: 0.5, why: "DY 10%" },
        { ticker: "KNCR11", score: 0.2, why: "DY 9.5%" },
      ]),
    ],
    [
      "ACAO",
      screenResult("ACAO", [
        { ticker: "BBAS3", score: 1.0, why: "ROE 22%" },
        { ticker: "ITSA4", score: 0.6, why: "ROE 17%" },
        { ticker: "TAEE11", score: 0.2, why: "ROE 14%" },
      ]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.suggestions.length, 6);
  const fiiAmounts = r.suggestions
    .filter((s) => s.asset_class === "FII")
    .map((s) => s.amount_brl);
  const acaoAmounts = r.suggestions
    .filter((s) => s.asset_class === "ACAO")
    .map((s) => s.amount_brl);
  assert.deepEqual(fiiAmounts, [300, 300, 300]); // 900 / 3
  assert.deepEqual(acaoAmounts, [200, 200, 200]); // 600 / 3
  assert.equal(r.total_to_invest_brl, 1500);
});

test("composeSuggestions: non-screenable underweight class goes to skipped_classes", () => {
  const d = drift([driftRow("TESOURO", "underweight", 1200)]);
  const r = composeSuggestions(d, new Map(), new Set(), 3);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.skipped_classes.length, 1);
  assert.equal(r.skipped_classes[0]?.asset_class, "TESOURO");
  assert.equal(r.skipped_classes[0]?.underweight_brl, 1200);
  assert.match(r.skipped_classes[0]?.reason ?? "", /TESOURO/);
  assert.equal(r.total_to_invest_brl, 0);
  assert.equal(r.total_skipped_brl, 1200);
});

test("composeSuggestions: mixed screenable + non-screenable", () => {
  const d = drift([
    driftRow("FII", "underweight", 600),
    driftRow("RENDA_FIXA_PRIVADA", "underweight", 400),
  ]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [
        { ticker: "MXRF11", score: 1.0, why: "DY 11%" },
        { ticker: "HGLG11", score: 0.5, why: "DY 10%" },
      ]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.suggestions.length, 2);
  assert.equal(r.skipped_classes.length, 1);
  assert.equal(r.skipped_classes[0]?.asset_class, "RENDA_FIXA_PRIVADA");
  assert.equal(r.total_to_invest_brl, 600);
  assert.equal(r.total_skipped_brl, 400);
});

test("composeSuggestions: already_owned flagged from ownedTickers set", () => {
  const d = drift([driftRow("FII", "underweight", 600)]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [
        { ticker: "MXRF11", score: 1.0, why: "DY 11%" },
        { ticker: "HGLG11", score: 0.5, why: "DY 10%" },
      ]),
    ],
  ]);
  const owned = new Set(["MXRF11"]);
  const r = composeSuggestions(d, screens, owned, 3);
  assert.equal(r.suggestions[0]?.ticker, "MXRF11");
  assert.equal(r.suggestions[0]?.already_owned, true);
  assert.equal(r.suggestions[1]?.ticker, "HGLG11");
  assert.equal(r.suggestions[1]?.already_owned, false);
});

test("composeSuggestions: actual_returned < top_n divides by actual_returned", () => {
  const d = drift([driftRow("FII", "underweight", 900)]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [{ ticker: "MXRF11", score: 1.0, why: "DY 11%" }]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.suggestions.length, 1);
  assert.equal(r.suggestions[0]?.amount_brl, 900); // 900 / 1, not 900 / 3
  assert.equal(r.total_to_invest_brl, 900);
});

test("composeSuggestions: actual_returned === 0 emits warning, no totals", () => {
  const d = drift([driftRow("FII", "underweight", 900)]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    ["FII", screenResult("FII", [], 50)],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.skipped_classes.length, 0);
  assert.equal(r.total_to_invest_brl, 0);
  assert.equal(r.total_skipped_brl, 0);
  assert.ok(
    r.warnings.some((w) => /FII.*no tickers passed screening/.test(w)),
    `expected warning about FII; got: ${JSON.stringify(r.warnings)}`,
  );
});

test("composeSuggestions: all classes within tolerance → empty + warning", () => {
  const d = drift([driftRow("FII", "ok"), driftRow("ACAO", "ok")]);
  const r = composeSuggestions(d, new Map(), new Set(), 3);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.skipped_classes.length, 0);
  assert.equal(r.total_to_invest_brl, 0);
  assert.ok(
    r.warnings.some((w) => /within tolerance/.test(w)),
    `expected within-tolerance warning; got: ${JSON.stringify(r.warnings)}`,
  );
});

test("composeSuggestions: overweight class is ignored (no SELL suggestion)", () => {
  const d = drift([
    driftRow("FII", "overweight", 500),
    driftRow("ACAO", "underweight", 300),
  ]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "ACAO",
      screenResult("ACAO", [{ ticker: "BBAS3", score: 1.0, why: "ROE 22%" }]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.suggestions.length, 1);
  assert.equal(r.suggestions[0]?.asset_class, "ACAO");
});

test("composeSuggestions: DISCLAIMER always first warning", () => {
  const d = drift([driftRow("FII", "underweight", 600)]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [{ ticker: "MXRF11", score: 1.0, why: "DY 11%" }]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.warnings[0], DISCLAIMER);
});

test("composeSuggestions: drift warnings forwarded", () => {
  const d: DriftReport = {
    total_brl: 0,
    tolerance_pp: 0,
    target_path: "/tmp/alloc.json",
    reference_date: null,
    drift: [],
    rebalance_net_brl: 0,
    warnings: ["No positions in database. Run import_xperformance_pdf first."],
  };
  const r = composeSuggestions(d, new Map(), new Set(), 3);
  assert.equal(r.suggestions.length, 0);
  assert.ok(
    r.warnings.some((w) => /No positions/.test(w)),
    `expected drift warning forwarded; got: ${JSON.stringify(r.warnings)}`,
  );
});

test("composeSuggestions: total_to_invest_brl equals sum of suggestion.amount_brl (post-round)", () => {
  // 1000 / 3 = 333.333... → round2 = 333.33 each → sum = 999.99
  const d = drift([driftRow("FII", "underweight", 1000)]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [
        { ticker: "A", score: 1, why: "x" },
        { ticker: "B", score: 0.5, why: "y" },
        { ticker: "C", score: 0.2, why: "z" },
      ]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  const sum = r.suggestions.reduce((acc, s) => acc + s.amount_brl, 0);
  assert.equal(r.total_to_invest_brl, sum);
  assert.equal(r.total_to_invest_brl, 999.99);
});

test("composeSuggestions: rationale forwarded verbatim from screen.why", () => {
  const d = drift([driftRow("FII", "underweight", 600)]);
  const screens = new Map<"FII" | "ACAO" | "ETF", ScreenAssetsResult>([
    [
      "FII",
      screenResult("FII", [
        { ticker: "MXRF11", score: 1.0, why: "DY 11.2% (median 9.4%)" },
      ]),
    ],
  ]);
  const r = composeSuggestions(d, screens, new Set(), 3);
  assert.equal(r.suggestions[0]?.rationale, "DY 11.2% (median 9.4%)");
});

// v0.12 — CRIPTO is not a ScreenableClass (FII/ACAO/ETF). An underweight CRIPTO
// row must not crash; it lands in skipped_classes via the existing
// non-screenable path, exactly like TESOURO/RENDA_FIXA/FUNDO.
test("composeSuggestions: CRIPTO underweight does not throw, goes to skipped_classes", () => {
  const d = drift([driftRow("CRIPTO", "underweight", 800)]);
  let r: SuggestBuysResult;
  assert.doesNotThrow(() => {
    r = composeSuggestions(d, new Map(), new Set(), 3);
  });
  r = composeSuggestions(d, new Map(), new Set(), 3);
  assert.equal(r.suggestions.length, 0);
  assert.equal(r.skipped_classes.length, 1);
  assert.equal(r.skipped_classes[0]?.asset_class, "CRIPTO");
  assert.equal(r.skipped_classes[0]?.underweight_brl, 800);
  assert.match(r.skipped_classes[0]?.reason ?? "", /CRIPTO/);
  assert.equal(r.total_skipped_brl, 800);
});
