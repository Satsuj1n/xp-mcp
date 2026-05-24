import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCashFlowSummary,
  rollingWindow,
  ytdStart,
} from "./cash-flow-summary.js";
import type { CashFlowRow } from "../storage/cash-flows-repo.js";

function mkFlow(
  flowDate: string,
  kind: "APORTE" | "RESGATE",
  amountCents: number,
  id = 1,
): CashFlowRow {
  return {
    id,
    flow_datetime: `${flowDate} 12:00:00`,
    flow_date: flowDate,
    kind,
    amount_cents: amountCents,
    description: "",
    import_id: 1,
  };
}

test("computeCashFlowSummary: happy path — mixed APORTE/RESGATE across multiple months", () => {
  // Jan/Feb/Mar 2026; asOfDate 2026-03-15
  // Aporte: 1000, 1500, 2000 BRL → 100000, 150000, 200000 cents
  // Resgate: 500 BRL in Feb → 50000 cents
  const rows: CashFlowRow[] = [
    mkFlow("2026-01-10", "APORTE", 100000, 1),
    mkFlow("2026-02-10", "APORTE", 150000, 2),
    mkFlow("2026-02-20", "RESGATE", 50000, 3),
    mkFlow("2026-03-05", "APORTE", 200000, 4),
  ];
  const out = computeCashFlowSummary(rows, "2026-03-15");

  assert.equal(out.as_of_date, "2026-03-15");
  assert.equal(out.total_records, 4);

  assert.equal(out.ytd.year, 2026);
  assert.equal(out.ytd.aporte_brl, 4500);
  assert.equal(out.ytd.resgate_brl, 500);
  assert.equal(out.ytd.net_brl, 4000);

  // Rolling window for 2026-03-15 → 2025-04 to 2026-03 (12 months).
  // All rows are inside, so totals match YTD.
  assert.equal(out.rolling_12m.from_month, "2025-04");
  assert.equal(out.rolling_12m.to_month, "2026-03");
  assert.equal(out.rolling_12m.months_with_data, 3);
  assert.equal(out.rolling_12m.aporte_brl, 4500);
  assert.equal(out.rolling_12m.resgate_brl, 500);
  assert.equal(out.rolling_12m.net_brl, 4000);
  assert.equal(out.rolling_12m.monthly_avg_aporte_brl, 1500);
  // round2(4000/3) = 1333.33
  assert.equal(out.rolling_12m.monthly_avg_net_brl, 1333.33);
});

test("computeCashFlowSummary: empty rows array → zeroed summary", () => {
  const out = computeCashFlowSummary([], "2026-05-24");

  assert.equal(out.as_of_date, "2026-05-24");
  assert.equal(out.total_records, 0);

  assert.equal(out.ytd.year, 2026);
  assert.equal(out.ytd.aporte_brl, 0);
  assert.equal(out.ytd.resgate_brl, 0);
  assert.equal(out.ytd.net_brl, 0);

  assert.equal(out.rolling_12m.months_with_data, 0);
  assert.equal(out.rolling_12m.aporte_brl, 0);
  assert.equal(out.rolling_12m.resgate_brl, 0);
  assert.equal(out.rolling_12m.net_brl, 0);
  assert.equal(out.rolling_12m.monthly_avg_aporte_brl, 0);
  assert.equal(out.rolling_12m.monthly_avg_net_brl, 0);
});

test("computeCashFlowSummary: all rows older than 12M window → ignored", () => {
  // asOfDate 2026-05-24 → rolling start 2025-06-01
  // Row on 2025-05-31 is one day before; must be ignored.
  const rows: CashFlowRow[] = [mkFlow("2025-05-31", "APORTE", 100000, 1)];
  const out = computeCashFlowSummary(rows, "2026-05-24");

  assert.equal(out.total_records, 0);
  assert.equal(out.rolling_12m.months_with_data, 0);
  assert.equal(out.rolling_12m.aporte_brl, 0);
  assert.equal(out.rolling_12m.net_brl, 0);
  assert.equal(out.ytd.aporte_brl, 0);
  assert.equal(out.ytd.net_brl, 0);
});

test("computeCashFlowSummary: YTD subset of rolling window", () => {
  // asOfDate 2026-06-15 → rolling 2025-07 to 2026-06
  // Row 1 (2026-05-01) is in both YTD and rolling.
  // Row 2 (2025-12-01) is in rolling, NOT in YTD.
  const rows: CashFlowRow[] = [
    mkFlow("2026-05-01", "APORTE", 100000, 1),
    mkFlow("2025-12-01", "APORTE", 200000, 2),
  ];
  const out = computeCashFlowSummary(rows, "2026-06-15");

  assert.equal(out.rolling_12m.from_month, "2025-07");
  assert.equal(out.rolling_12m.to_month, "2026-06");

  assert.equal(out.ytd.aporte_brl, 1000);
  assert.equal(out.ytd.net_brl, 1000);

  assert.equal(out.rolling_12m.aporte_brl, 3000);
  assert.equal(out.rolling_12m.net_brl, 3000);
  assert.equal(out.rolling_12m.months_with_data, 2);

  assert.notEqual(out.ytd.aporte_brl, out.rolling_12m.aporte_brl);
});

test("computeCashFlowSummary: single month with multiple rows", () => {
  const rows: CashFlowRow[] = [
    mkFlow("2026-05-15", "APORTE", 100000, 1),
    mkFlow("2026-05-15", "APORTE", 50000, 2),
    mkFlow("2026-05-15", "APORTE", 30000, 3),
  ];
  const out = computeCashFlowSummary(rows, "2026-05-24");

  assert.equal(out.total_records, 3);
  assert.equal(out.rolling_12m.months_with_data, 1);
  assert.equal(out.rolling_12m.aporte_brl, 1800);
  assert.equal(out.rolling_12m.net_brl, 1800);
  assert.equal(out.rolling_12m.monthly_avg_aporte_brl, 1800);
  assert.equal(out.rolling_12m.monthly_avg_net_brl, 1800);
});

test("computeCashFlowSummary: row exactly on rolling start qualifies", () => {
  // asOfDate 2026-05-31 → rolling start 2025-06-01
  const rows: CashFlowRow[] = [mkFlow("2025-06-01", "APORTE", 100000, 1)];
  const out = computeCashFlowSummary(rows, "2026-05-31");

  assert.equal(out.rolling_12m.from_month, "2025-06");
  assert.equal(out.rolling_12m.to_month, "2026-05");
  assert.equal(out.total_records, 1);
  assert.equal(out.rolling_12m.months_with_data, 1);
  assert.equal(out.rolling_12m.aporte_brl, 1000);
});

test("computeCashFlowSummary: row one day before rolling start is excluded", () => {
  // asOfDate 2026-05-31 → rolling start 2025-06-01
  const rows: CashFlowRow[] = [mkFlow("2025-05-31", "APORTE", 100000, 1)];
  const out = computeCashFlowSummary(rows, "2026-05-31");

  assert.equal(out.total_records, 0);
  assert.equal(out.rolling_12m.months_with_data, 0);
  assert.equal(out.rolling_12m.aporte_brl, 0);
});

test("computeCashFlowSummary: January asOfDate — YTD has Jan rows only; rolling sweeps back", () => {
  // asOfDate 2026-01-15
  // Row on 2026-01-10 → in YTD
  // Row on 2025-12-15 → in rolling (rolling 2025-02 to 2026-01), NOT in YTD
  const rows: CashFlowRow[] = [
    mkFlow("2026-01-10", "APORTE", 100000, 1),
    mkFlow("2025-12-15", "APORTE", 200000, 2),
  ];
  const out = computeCashFlowSummary(rows, "2026-01-15");

  assert.equal(out.ytd.year, 2026);
  assert.equal(out.ytd.aporte_brl, 1000);
  assert.equal(out.ytd.net_brl, 1000);

  assert.equal(out.rolling_12m.from_month, "2025-02");
  assert.equal(out.rolling_12m.to_month, "2026-01");
  assert.equal(out.rolling_12m.aporte_brl, 3000);
  assert.equal(out.rolling_12m.months_with_data, 2);
});

test("computeCashFlowSummary: cross-year rolling window", () => {
  // asOfDate 2026-02-28 → rolling 2025-03 to 2026-02
  const rows: CashFlowRow[] = [
    mkFlow("2025-12-10", "APORTE", 100000, 1),
    mkFlow("2026-01-10", "APORTE", 200000, 2),
  ];
  const out = computeCashFlowSummary(rows, "2026-02-28");

  assert.equal(out.rolling_12m.from_month, "2025-03");
  assert.equal(out.rolling_12m.to_month, "2026-02");
  assert.equal(out.rolling_12m.months_with_data, 2);
  assert.equal(out.rolling_12m.aporte_brl, 3000);
});

test("computeCashFlowSummary: resgate-only month → negative net", () => {
  const rows: CashFlowRow[] = [mkFlow("2026-04-15", "RESGATE", 500000, 1)];
  const out = computeCashFlowSummary(rows, "2026-05-24");

  assert.equal(out.rolling_12m.aporte_brl, 0);
  assert.equal(out.rolling_12m.resgate_brl, 5000);
  assert.equal(out.rolling_12m.net_brl, -5000);
  assert.equal(out.ytd.aporte_brl, 0);
  assert.equal(out.ytd.resgate_brl, 5000);
  assert.equal(out.ytd.net_brl, -5000);
});

test("computeCashFlowSummary: rounding — odd cents → BRL with 2 decimals", () => {
  // 123456 cents → R$ 1234.56
  const rows: CashFlowRow[] = [mkFlow("2026-05-10", "APORTE", 123456, 1)];
  const out = computeCashFlowSummary(rows, "2026-05-24");

  assert.equal(out.ytd.aporte_brl, 1234.56);
  assert.equal(out.rolling_12m.aporte_brl, 1234.56);
  assert.equal(out.rolling_12m.monthly_avg_aporte_brl, 1234.56);
});

test("computeCashFlowSummary: large numbers — no float drift", () => {
  // 3 rows: 33_333_333 + 33_333_334 + 33_333_333 = 100_000_000 cents = R$ 1_000_000.00
  const rows: CashFlowRow[] = [
    mkFlow("2026-03-10", "APORTE", 33_333_333, 1),
    mkFlow("2026-04-10", "APORTE", 33_333_334, 2),
    mkFlow("2026-05-10", "APORTE", 33_333_333, 3),
  ];
  const out = computeCashFlowSummary(rows, "2026-05-24");

  assert.equal(out.ytd.aporte_brl, 1_000_000);
  assert.equal(out.ytd.net_brl, 1_000_000);
  assert.equal(out.rolling_12m.aporte_brl, 1_000_000);
  assert.equal(out.rolling_12m.months_with_data, 3);
  // Average across 3 months = 333_333.33 (each month is exactly R$ 333_333.33 or 333_333.34)
  // 1_000_000 / 3 = 333_333.3333... → round2 → 333_333.33
  assert.equal(
    out.rolling_12m.monthly_avg_aporte_brl,
    Math.round((1_000_000 / 3) * 100) / 100,
  );
});

// --- Tests for exported helpers (Task 3 will use them from the tool wrapper) ---

test("ytdStart: returns YYYY-01-01 from asOfDate", () => {
  assert.equal(ytdStart("2026-05-24"), "2026-01-01");
  assert.equal(ytdStart("2025-12-31"), "2025-01-01");
  assert.equal(ytdStart("2026-01-01"), "2026-01-01");
});

test("rollingWindow: mid-year, simple case", () => {
  const w = rollingWindow("2026-05-24");
  assert.equal(w.fromMonth, "2025-06");
  assert.equal(w.toMonth, "2026-05");
  assert.equal(w.startDate, "2025-06-01");
});

test("rollingWindow: January wraps to prior February", () => {
  const w = rollingWindow("2026-01-15");
  assert.equal(w.fromMonth, "2025-02");
  assert.equal(w.toMonth, "2026-01");
  assert.equal(w.startDate, "2025-02-01");
});

test("rollingWindow: December — no wrap", () => {
  const w = rollingWindow("2026-12-15");
  assert.equal(w.fromMonth, "2026-01");
  assert.equal(w.toMonth, "2026-12");
  assert.equal(w.startDate, "2026-01-01");
});
