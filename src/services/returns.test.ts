import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeReturns,
  computeTwr,
  computeMwr,
  daysBetween,
} from "./returns.js";
import type { SnapshotRow } from "../storage/imports-repo.js";
import type { CashFlowRow } from "../storage/cash-flows-repo.js";

// --- helpers ----------------------------------------------------------------

function mkSnap(
  referenceDate: string,
  declaredTotalBrl: number,
  importId = 1,
): SnapshotRow {
  return {
    reference_date: referenceDate,
    declared_total_cents: Math.round(declaredTotalBrl * 100),
    import_id: importId,
    imported_at: `${referenceDate} 23:59:59`,
  };
}

function mkFlow(
  flowDate: string,
  kind: "APORTE" | "RESGATE",
  amountBrl: number,
  id = 1,
): CashFlowRow {
  return {
    id,
    flow_datetime: `${flowDate} 12:00:00`,
    flow_date: flowDate,
    kind,
    amount_cents: Math.round(amountBrl * 100),
    description: "",
    import_id: 1,
  };
}

const APPROX = 1e-4;

// --- Wave 1: foundation -----------------------------------------------------

test("daysBetween: basic arithmetic — same date, single day, full year", () => {
  assert.equal(daysBetween("2025-01-01", "2025-01-01"), 0);
  assert.equal(daysBetween("2025-01-01", "2025-01-02"), 1);
  assert.equal(daysBetween("2025-01-01", "2025-02-01"), 31);
  // 2025 is not a leap year → 365 days
  assert.equal(daysBetween("2025-01-01", "2026-01-01"), 365);
  // 2024 is leap → Feb has 29 days; Jan 1 2024 to Jan 1 2025 = 366
  assert.equal(daysBetween("2024-01-01", "2025-01-01"), 366);
  // reverse direction is negative
  assert.equal(daysBetween("2025-02-01", "2025-01-01"), -31);
});

test("computeTwr: canonical CFA Modified Dietz example — single mid-period aporte", () => {
  // V_start = 100,000 on 2025-01-01
  // Aporte +10,000 on 2025-01-16 (day 15)
  // V_end = 115,000 on 2025-02-01 (31 days later)
  // weight = (31 - 15) / 31 = 16/31
  // weighted_cf = 10000 * 16/31 ≈ 5161.29
  // numerator = 115000 - 100000 - 10000 = 5000
  // denominator = 100000 + 5161.29 = 105161.29
  // period_return = 5000 / 105161.29 ≈ 0.04755
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 100_000, 1),
    mkSnap("2025-02-01", 115_000, 2),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-01-16", "APORTE", 10_000, 1)];
  const twr = computeTwr(snaps, flows);

  assert.equal(twr.sub_periods.length, 1);
  assert.ok(
    Math.abs(twr.twr_period - 0.04755) < APPROX,
    `expected ~0.04755, got ${twr.twr_period}`,
  );
  assert.ok(
    Math.abs(twr.sub_periods[0]!.period_return - 0.04755) < APPROX,
    `sub-period return expected ~0.04755, got ${twr.sub_periods[0]!.period_return}`,
  );
});

test("computeMwr: 1Y no cash flows — IRR exactly 10%", () => {
  // V_start = 100,000 on 2025-01-01
  // V_end = 110,000 on 2026-01-01 (365 days)
  // Cash flows: [(2025-01-01, -100000), (2026-01-01, +110000)]
  // IRR: -100000 + 110000 / (1+r) = 0 → r = 0.10
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 100_000, 1),
    mkSnap("2026-01-01", 110_000, 2),
  ];
  const mwr = computeMwr(snaps, []);

  assert.equal(mwr.converged, true);
  assert.ok(mwr.mwr_annualized !== null);
  assert.ok(
    Math.abs(mwr.mwr_annualized! - 0.1) < APPROX,
    `expected mwr_annualized ≈ 0.10, got ${mwr.mwr_annualized}`,
  );
  assert.ok(mwr.mwr_period !== null);
  // period return ≈ 0.10 too (since period = exactly 1 year)
  assert.ok(
    Math.abs(mwr.mwr_period! - 0.1) < APPROX,
    `expected mwr_period ≈ 0.10, got ${mwr.mwr_period}`,
  );
  // Breakdown: INITIAL_NAV (-100k) and TERMINAL_NAV (+110k)
  assert.equal(mwr.cash_flows_breakdown.length, 2);
  assert.equal(mwr.cash_flows_breakdown[0]!.label, "INITIAL_NAV");
  assert.equal(mwr.cash_flows_breakdown[0]!.signed_brl, -100_000);
  assert.equal(mwr.cash_flows_breakdown[1]!.label, "TERMINAL_NAV");
  assert.equal(mwr.cash_flows_breakdown[1]!.signed_brl, 110_000);
});

// --- Wave 2: chain + sign handling ------------------------------------------

test("computeTwr: no cash flows — geometric return 10%", () => {
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-02-01", 1100, 2),
  ];
  const twr = computeTwr(snaps, []);
  assert.equal(twr.sub_periods.length, 1);
  assert.ok(Math.abs(twr.twr_period - 0.1) < APPROX);
  assert.equal(twr.sub_periods[0]!.starting_value_brl, 1000);
  assert.equal(twr.sub_periods[0]!.ending_value_brl, 1100);
  assert.equal(twr.sub_periods[0]!.net_cash_flow_brl, 0);
});

test("computeTwr: geometric chain across 3 snapshots → 2 sub-periods", () => {
  // Sub-period 1: 1000 → 1100, no flows, r1 = 0.10
  // Sub-period 2: 1100 → 1210, no flows, r2 = 0.10
  // chain = (1.1)*(1.1) - 1 = 0.21
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-02-01", 1100, 2),
    mkSnap("2025-03-01", 1210, 3),
  ];
  const twr = computeTwr(snaps, []);
  assert.equal(twr.sub_periods.length, 2);
  assert.ok(Math.abs(twr.sub_periods[0]!.period_return - 0.1) < APPROX);
  assert.ok(Math.abs(twr.sub_periods[1]!.period_return - 0.1) < APPROX);
  assert.ok(Math.abs(twr.twr_period - 0.21) < APPROX);
});

test("computeTwr: RESGATE in mid-period — sign handling correct", () => {
  // V_start = 100_000 on 2025-01-01
  // RESGATE -5_000 on 2025-01-16
  // V_end = 100_000 on 2025-02-01 (31 days)
  // For Modified Dietz, RESGATE → negative amount
  // weighted_cf = -5000 * 16/31 ≈ -2580.65
  // numerator = 100_000 - 100_000 - (-5000) = 5000
  // denominator = 100_000 - 2580.65 = 97419.35
  // period_return ≈ 5000 / 97419.35 ≈ 0.05132
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 100_000, 1),
    mkSnap("2025-02-01", 100_000, 2),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-01-16", "RESGATE", 5_000, 1)];
  const twr = computeTwr(snaps, flows);
  assert.equal(twr.sub_periods.length, 1);
  assert.equal(twr.sub_periods[0]!.net_cash_flow_brl, -5_000);
  assert.ok(
    Math.abs(twr.sub_periods[0]!.period_return - 0.05132) < APPROX,
    `expected ~0.05132, got ${twr.sub_periods[0]!.period_return}`,
  );
});

test("computeTwr: same-day flow on snapshot date goes into NEXT sub-period", () => {
  // Snapshots on 2025-01-01, 2025-02-01, 2025-03-01.
  // Flow on 2025-02-01 (matches mid-snapshot date).
  // Per spec § 5.1: flow belongs to (S_i, S_{i+1}], so flow on S_2 lands
  // in sub-period 2 (between S_2 and S_3), with daysFromStart = 0.
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-02-01", 1100, 2),
    mkSnap("2025-03-01", 1300, 3),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-02-01", "APORTE", 100, 1)];
  const twr = computeTwr(snaps, flows);
  // sub-period 1: no flow → net = 0
  assert.equal(twr.sub_periods[0]!.net_cash_flow_brl, 0);
  assert.equal(twr.sub_periods[0]!.flows_in_period, 0);
  // sub-period 2: the flow lands here
  assert.equal(twr.sub_periods[1]!.net_cash_flow_brl, 100);
  assert.equal(twr.sub_periods[1]!.flows_in_period, 1);
});

test("computeTwr: same-day flow on FIRST snapshot lands in first sub-period", () => {
  // Spec § 5.1: a flow exactly on `period_from` (first snapshot date) is
  // included in the first sub-period.
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-02-01", 1100, 2),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-01-01", "APORTE", 100, 1)];
  const twr = computeTwr(snaps, flows);
  assert.equal(twr.sub_periods.length, 1);
  assert.equal(twr.sub_periods[0]!.flows_in_period, 1);
  assert.equal(twr.sub_periods[0]!.net_cash_flow_brl, 100);
});

test("computeTwr: same-day flow on LAST snapshot lands in last sub-period", () => {
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-02-01", 1100, 2),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-02-01", "APORTE", 100, 1)];
  const twr = computeTwr(snaps, flows);
  assert.equal(twr.sub_periods.length, 1);
  assert.equal(twr.sub_periods[0]!.flows_in_period, 1);
  assert.equal(twr.sub_periods[0]!.net_cash_flow_brl, 100);
});

// --- Wave 3: edge cases -----------------------------------------------------

test("computeReturns: empty cash flows — TWR = simple geometric, MWR = annualized growth", () => {
  // V_start = 100_000 on 2025-01-01
  // V_end = 110_000 on 2026-01-01 (365 days)
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 100_000, 1),
    mkSnap("2026-01-01", 110_000, 2),
  ];
  const r = computeReturns(snaps, []);
  // TWR period ≈ 0.10
  assert.ok(Math.abs(r.twr.twr_period - 0.1) < APPROX);
  // MWR period ≈ 0.10
  assert.ok(r.mwr.mwr_period !== null);
  assert.ok(Math.abs(r.mwr.mwr_period! - 0.1) < APPROX);
  // Both annualized ≈ 0.10
  assert.ok(r.twr.twr_annualized !== null);
  assert.ok(Math.abs(r.twr.twr_annualized! - 0.1) < APPROX);
  assert.ok(r.mwr.mwr_annualized !== null);
  assert.ok(Math.abs(r.mwr.mwr_annualized! - 0.1) < APPROX);
  assert.equal(r.cash_flows_used, 0);
  assert.equal(r.snapshots_used, 2);
  assert.equal(r.days, 365);
});

test("computeTwr: period < 30 days — twr_annualized is null + warning", () => {
  // 10-day period
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-01-11", 1010, 2),
  ];
  const twr = computeTwr(snaps, []);
  assert.equal(twr.twr_annualized, null);
  assert.ok(
    twr.warnings.some((w) => w.includes("annualized return omitted")),
    `expected tiny-period warning, got: ${JSON.stringify(twr.warnings)}`,
  );
});

test("computeTwr: cross-year period — Dec to Jan with Christmas flow", () => {
  // Snapshots span Dec 1 → Feb 1 (62 days)
  // Flow on Dec 25 (mid-period)
  const snaps: SnapshotRow[] = [
    mkSnap("2025-12-01", 100_000, 1),
    mkSnap("2026-02-01", 120_000, 2),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-12-25", "APORTE", 10_000, 1)];
  const twr = computeTwr(snaps, flows);
  assert.equal(twr.sub_periods.length, 1);
  assert.equal(twr.sub_periods[0]!.from, "2025-12-01");
  assert.equal(twr.sub_periods[0]!.to, "2026-02-01");
  assert.equal(twr.sub_periods[0]!.days, 62);
  assert.equal(twr.sub_periods[0]!.net_cash_flow_brl, 10_000);
  // sanity: 20_000 of gain minus 10_000 aporte → positive return
  assert.ok(twr.twr_period > 0);
});

test("computeMwr: bisection non-convergence — no sign change → converged: false + warning", () => {
  // Force a no-sign-change case: positive returns + positive cash flows
  // such that NPV is always positive over [-0.99, 10]. We use a giant
  // synthetic terminal that overwhelms intermediate aporte signs.
  // Easier: snapshots where vFirst = 0 makes initial cash flow 0, leaving
  // only positive flows in the signed series (no sign change).
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 0, 1),
    mkSnap("2025-12-01", 100_000, 2),
  ];
  // No intermediate flows: signed series is [(-0), (+100000)]. The -0
  // collapses to 0 — there is technically a sign change since 0 counts
  // as "no sign". To genuinely break convergence we need all positive
  // flows. Use snapshots with vFirst > 0 but flip signs via construction.
  //
  // Easier: APORTE on the LAST snapshot date → +TERMINAL_NAV combined
  // with -APORTE that nets out. Use snapshots where vFirst > 0 but
  // intermediate RESGATE > vFirst making cumulative signed flow problematic.
  //
  // Simplest direct construction: 2 snapshots with vFirst=100, vLast=100
  // (zero gain) + zero flows → IRR is exactly 0. That converges. NOT
  // useful here.
  //
  // To force no sign change, use a snapshot pair where flows match
  // exactly: vFirst=100, vLast=0, with synthetic terminal 0.
  // signed series = [-100, +0] = both ≤ 0 → no sign change in flat
  // direction → bisection returns converged: false.
  const snaps2: SnapshotRow[] = [
    mkSnap("2025-01-01", 100, 1),
    mkSnap("2025-12-01", 0, 2),
  ];
  void snaps; // satisfy lint for the variable above; primary scenario is snaps2
  const mwr = computeMwr(snaps2, []);
  // signed cash flows: [-100 (INITIAL_NAV), +0 (TERMINAL_NAV)]
  // NPV(r) = -100 + 0 / (1+r)^t = -100, constant negative → no sign change
  assert.equal(mwr.converged, false);
  assert.equal(mwr.mwr_period, null);
  assert.equal(mwr.mwr_annualized, null);
  assert.ok(
    mwr.warnings.some((w) => w.includes("did not converge")),
    `expected non-convergence warning, got: ${JSON.stringify(mwr.warnings)}`,
  );
});

test("computeReturns: duplicate same-date snapshots — tolerated (single sub-period)", () => {
  // The repo's `imported_at DESC` tiebreaker should dedupe upstream, but
  // the service should not crash. Two same-date snapshots collapse to one
  // sub-period of 0 days that is skipped.
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-01-01", 1000, 2),
    mkSnap("2025-02-01", 1100, 3),
  ];
  const r = computeReturns(snaps, []);
  // Effective sub-periods: only the non-zero-day one
  assert.equal(r.twr.sub_periods.length, 1);
  assert.ok(Math.abs(r.twr.twr_period - 0.1) < APPROX);
});

test("computeTwr: large cash flow > 30% of starting value → warning + still computes", () => {
  // V_start = 1000, aporte 500 (50%) mid-period, V_end = 1700
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-02-01", 1700, 2),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-01-16", "APORTE", 500, 1)];
  const twr = computeTwr(snaps, flows);
  assert.equal(twr.sub_periods.length, 1);
  assert.ok(twr.sub_periods[0]!.max_flow_pct >= 0.3);
  assert.ok(
    twr.warnings.some((w) => w.includes("Modified Dietz may overstate")),
    `expected large-flow warning, got: ${JSON.stringify(twr.warnings)}`,
  );
});

test("computeMwr: period reconstruction — (1+ann)^(days/365) - 1 ≈ mwr_period", () => {
  // Use the canonical 1Y 10% case + a mid-period aporte to make IRR
  // non-trivial, then verify the reconstruction identity.
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 100_000, 1),
    mkSnap("2026-01-01", 200_000, 2),
  ];
  const flows: CashFlowRow[] = [mkFlow("2025-07-01", "APORTE", 50_000, 1)];
  const mwr = computeMwr(snaps, flows);
  assert.equal(mwr.converged, true);
  assert.ok(mwr.mwr_period !== null);
  assert.ok(mwr.mwr_annualized !== null);
  const days = 365;
  const reconstructed = Math.pow(1 + mwr.mwr_annualized!, days / 365) - 1;
  assert.ok(
    Math.abs(reconstructed - mwr.mwr_period!) < APPROX,
    `reconstruction mismatch: ${reconstructed} vs ${mwr.mwr_period}`,
  );
});

test("computeReturns: sparse-history warning on long sub-period with many flows", () => {
  // Sub-period of 90 days with 4 flows → triggers sparse-history warning.
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 100_000, 1),
    mkSnap("2025-04-01", 110_000, 2), // 90 days
  ];
  const flows: CashFlowRow[] = [
    mkFlow("2025-01-15", "APORTE", 1000, 1),
    mkFlow("2025-02-01", "APORTE", 1000, 2),
    mkFlow("2025-02-15", "APORTE", 1000, 3),
    mkFlow("2025-03-15", "APORTE", 1000, 4),
  ];
  const r = computeReturns(snaps, flows);
  assert.ok(
    r.twr.warnings.some((w) => w.includes("Modified Dietz precision degrades")),
    `expected sparse-history warning, got: ${JSON.stringify(r.twr.warnings)}`,
  );
});

test("computeReturns: meta — period_from, period_to, days, snapshots_used, cash_flows_used", () => {
  const snaps: SnapshotRow[] = [
    mkSnap("2025-01-01", 1000, 1),
    mkSnap("2025-02-01", 1100, 2),
    mkSnap("2025-03-01", 1210, 3),
  ];
  const flows: CashFlowRow[] = [
    mkFlow("2025-01-15", "APORTE", 100, 1),
    mkFlow("2025-02-20", "APORTE", 100, 2),
  ];
  const r = computeReturns(snaps, flows);
  assert.equal(r.period_from, "2025-01-01");
  assert.equal(r.period_to, "2025-03-01");
  assert.equal(r.days, 59); // Jan 1 → Mar 1 = 31 + 28
  assert.equal(r.snapshots_used, 3);
  assert.equal(r.cash_flows_used, 2);
  // Same meta also surfaces on TwrCore and MwrCore
  assert.equal(r.twr.snapshots_used, 3);
  assert.equal(r.twr.cash_flows_used, 2);
  assert.equal(r.twr.period_from, "2025-01-01");
  assert.equal(r.twr.period_to, "2025-03-01");
  assert.equal(r.twr.days, 59);
  assert.equal(r.mwr.snapshots_used, 3);
  assert.equal(r.mwr.cash_flows_used, 2);
});

test("computeReturns: flows outside snapshot window are excluded", () => {
  // Snapshots 2025-02-01 → 2025-04-01. Flow on 2025-01-15 is before
  // first snapshot; flow on 2025-05-01 is after last → both excluded.
  const snaps: SnapshotRow[] = [
    mkSnap("2025-02-01", 1000, 1),
    mkSnap("2025-04-01", 1100, 2),
  ];
  const flows: CashFlowRow[] = [
    mkFlow("2025-01-15", "APORTE", 999_999, 1), // before window
    mkFlow("2025-03-01", "APORTE", 100, 2), // in window
    mkFlow("2025-05-01", "APORTE", 999_999, 3), // after window
  ];
  const r = computeReturns(snaps, flows);
  assert.equal(r.cash_flows_used, 1);
});
