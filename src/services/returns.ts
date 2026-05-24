import { round2 } from "./money.js";
import type { SnapshotRow } from "../storage/imports-repo.js";
import type { CashFlowRow } from "../storage/cash-flows-repo.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TwrSubPeriod {
  from: string; // YYYY-MM-DD
  to: string;
  days: number;
  starting_value_brl: number;
  ending_value_brl: number;
  net_cash_flow_brl: number;
  period_return: number; // decimal
  flows_in_period: number; // count, for warnings
  max_flow_pct: number; // |flow| / starting_value, for warnings
}

export interface TwrCore {
  period_from: string;
  period_to: string;
  days: number;
  snapshots_used: number;
  cash_flows_used: number;
  twr_period: number;
  twr_annualized: number | null;
  sub_periods: TwrSubPeriod[];
  warnings: string[];
}

export interface MwrCashFlow {
  date: string;
  signed_brl: number; // signed from investor's perspective
  label: "INITIAL_NAV" | "APORTE" | "RESGATE" | "TERMINAL_NAV";
}

export interface MwrCore {
  period_from: string;
  period_to: string;
  days: number;
  snapshots_used: number;
  cash_flows_used: number;
  mwr_period: number | null;
  mwr_annualized: number | null;
  converged: boolean;
  iterations: number;
  npv_at_solution: number | null;
  cash_flows_breakdown: MwrCashFlow[];
  warnings: string[];
}

export interface ReturnsCore {
  period_from: string;
  period_to: string;
  days: number;
  snapshots_used: number;
  cash_flows_used: number;
  twr: TwrCore;
  mwr: MwrCore;
}

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

/**
 * Calendar days between two ISO `YYYY-MM-DD` dates. Uses `Date.UTC` to
 * avoid local-timezone surprises around midnight. Positive when `b > a`,
 * negative when `a > b`, zero when equal.
 *
 * Exported because the tool wrapper (Task 3) also needs it for the
 * stale-tail warning calculation.
 */
export function daysBetween(a: string, b: string): number {
  const aMs = Date.UTC(
    parseInt(a.slice(0, 4), 10),
    parseInt(a.slice(5, 7), 10) - 1,
    parseInt(a.slice(8, 10), 10),
  );
  const bMs = Date.UTC(
    parseInt(b.slice(0, 4), 10),
    parseInt(b.slice(5, 7), 10) - 1,
    parseInt(b.slice(8, 10), 10),
  );
  return Math.round((bMs - aMs) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Modified Dietz (one sub-period)
// ---------------------------------------------------------------------------

interface FlowInPeriod {
  amount: number; // signed BRL (APORTE +, RESGATE -)
  daysFromStart: number;
}

function modifiedDietz(
  vStart: number,
  vEnd: number,
  flowsInPeriod: readonly FlowInPeriod[],
  periodDays: number,
): number {
  const netCf = flowsInPeriod.reduce((s, f) => s + f.amount, 0);
  const weightedCf = flowsInPeriod.reduce(
    (s, f) => s + f.amount * ((periodDays - f.daysFromStart) / periodDays),
    0,
  );
  const numerator = vEnd - vStart - netCf;
  const denominator = vStart + weightedCf;
  if (denominator === 0) return 0;
  return numerator / denominator;
}

// ---------------------------------------------------------------------------
// Bisection IRR
// ---------------------------------------------------------------------------

interface IrrFlow {
  date: string;
  amount: number; // signed BRL from investor's perspective
}

interface BisectResult {
  rate: number | null;
  converged: boolean;
  iterations: number;
  npvAtSolution: number | null;
}

function npv(
  rate: number,
  flows: readonly IrrFlow[],
  anchorDate: string,
): number {
  return flows.reduce((sum, f) => {
    const t = daysBetween(anchorDate, f.date) / 365;
    return sum + f.amount / Math.pow(1 + rate, t);
  }, 0);
}

function bisectIrr(
  flows: readonly IrrFlow[],
  anchorDate: string,
): BisectResult {
  let lo = -0.99;
  let hi = 10.0;
  const fLo = npv(lo, flows, anchorDate);
  const fHi = npv(hi, flows, anchorDate);
  if (fLo * fHi > 0) {
    return { rate: null, converged: false, iterations: 0, npvAtSolution: null };
  }
  const TOL = 1e-6;
  let fLoCur = fLo;
  for (let i = 1; i <= 100; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows, anchorDate);
    if (Math.abs(fMid) < TOL) {
      return { rate: mid, converged: true, iterations: i, npvAtSolution: fMid };
    }
    if (fLoCur * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
      fLoCur = fMid;
    }
  }
  return { rate: null, converged: false, iterations: 100, npvAtSolution: null };
}

// ---------------------------------------------------------------------------
// Service entry points
// ---------------------------------------------------------------------------

/**
 * Compute TWR (Modified Dietz chained) and MWR (bisection IRR) over the
 * given snapshots and cash flows. Caller MUST validate
 * `snapshots.length >= 2` before calling. Snapshots MUST be sorted by
 * `reference_date` ASC.
 *
 * Same-date snapshot dedupe (defensive): the repo's `imported_at DESC`
 * tiebreaker already keeps the latest, but the service tolerates
 * duplicates by skipping zero-day sub-periods.
 *
 * Cash flows outside the snapshot window are silently excluded.
 * Same-day flow on the FIRST snapshot lands in the first sub-period
 * (with `daysFromStart = 0`). Same-day flow on any other snapshot
 * `S_i` lands in the NEXT sub-period `(S_i, S_{i+1}]`. Same-day flow
 * on the LAST snapshot lands in the LAST sub-period (with
 * `daysFromStart = periodDays`, i.e. weight 0).
 */
export function computeReturns(
  snapshots: readonly SnapshotRow[],
  cashFlows: readonly CashFlowRow[],
): ReturnsCore {
  // 1) Dedupe same-date snapshots — keep first occurrence (repo already
  //    sorts ASC and gives `imported_at DESC` so the kept one is the
  //    most recent import for that date).
  const seenDates = new Set<string>();
  const uniqueSnaps: SnapshotRow[] = [];
  for (const s of snapshots) {
    if (!seenDates.has(s.reference_date)) {
      seenDates.add(s.reference_date);
      uniqueSnaps.push(s);
    }
  }

  const firstDate = uniqueSnaps[0]!.reference_date;
  const lastDate = uniqueSnaps[uniqueSnaps.length - 1]!.reference_date;
  const totalDays = daysBetween(firstDate, lastDate);

  // 2) Filter cash flows to the snapshot window (inclusive on both ends).
  const windowFlows = cashFlows.filter(
    (f) => f.flow_date >= firstDate && f.flow_date <= lastDate,
  );

  // 3) Compute TWR via Modified Dietz chain
  const twr = computeTwrCore(uniqueSnaps, windowFlows, totalDays);

  // 4) Compute MWR via bisection IRR
  const mwr = computeMwrCore(uniqueSnaps, windowFlows, totalDays);

  // Stamp shared meta on each core for the tool wrappers to project.
  const sharedMeta = {
    period_from: firstDate,
    period_to: lastDate,
    days: totalDays,
    snapshots_used: uniqueSnaps.length,
    cash_flows_used: windowFlows.length,
  };

  return {
    ...sharedMeta,
    twr: { ...sharedMeta, ...twr },
    mwr: { ...sharedMeta, ...mwr },
  };
}

export function computeTwr(
  snapshots: readonly SnapshotRow[],
  cashFlows: readonly CashFlowRow[],
): TwrCore {
  return computeReturns(snapshots, cashFlows).twr;
}

export function computeMwr(
  snapshots: readonly SnapshotRow[],
  cashFlows: readonly CashFlowRow[],
): MwrCore {
  return computeReturns(snapshots, cashFlows).mwr;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type TwrCoreMath = Omit<
  TwrCore,
  "period_from" | "period_to" | "days" | "snapshots_used" | "cash_flows_used"
>;

function computeTwrCore(
  snaps: readonly SnapshotRow[],
  windowFlows: readonly CashFlowRow[],
  totalDays: number,
): TwrCoreMath {
  const subPeriods: TwrSubPeriod[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < snaps.length - 1; i++) {
    const sStart = snaps[i]!;
    const sEnd = snaps[i + 1]!;
    const periodDays = daysBetween(sStart.reference_date, sEnd.reference_date);
    if (periodDays <= 0) continue; // skip zero-day (duplicate snapshots)

    const isLastSubPeriod = i === snaps.length - 2;

    // Assign flows to this sub-period per the spec § 5.1 same-day rule:
    //  - A flow on S_i.date (any i, including last) is considered to
    //    occur AFTER the snapshot → it belongs to (S_i, S_{i+1}].
    //  - The exception is the FIRST snapshot: a flow on the first
    //    snapshot's date is included in the first sub-period (i.e. it
    //    DOES count for sub-period 0, with daysFromStart = 0).
    //  - A flow on the LAST snapshot's date lands in the last sub-period
    //    (with daysFromStart = periodDays, weight 0).
    //
    // In this loop, sub-period i has (sStart, sEnd] = (snaps[i], snaps[i+1]].
    //  - onStart (f.flow_date === sStart.reference_date):
    //      i == 0 → belongs here (first-sub-period exception)
    //      i  > 0 → belongs here too (the "after S_i" rule lands flows
    //               on S_i into the sub-period that STARTS at S_i,
    //               which is this iteration)
    //  - onEnd (f.flow_date === sEnd.reference_date):
    //      isLastSubPeriod → belongs here
    //      else → belongs to next iteration (flow on S_{i+1} is "after
    //             S_{i+1}", so it goes into (S_{i+1}, S_{i+2}])
    //  - strictly inside (sStart, sEnd) → belongs here
    const flowsInPeriod: FlowInPeriod[] = [];
    let netCf = 0;
    let maxFlowAbs = 0;
    for (const f of windowFlows) {
      const onStart = f.flow_date === sStart.reference_date;
      const onEnd = f.flow_date === sEnd.reference_date;
      const strictlyInside =
        f.flow_date > sStart.reference_date &&
        f.flow_date < sEnd.reference_date;

      let belongsHere = strictlyInside || onStart;
      if (onEnd) belongsHere = isLastSubPeriod;

      if (!belongsHere) continue;

      const signed =
        f.kind === "APORTE" ? f.amount_cents / 100 : -(f.amount_cents / 100);
      const daysFromStart = daysBetween(sStart.reference_date, f.flow_date);
      flowsInPeriod.push({ amount: signed, daysFromStart });
      netCf += signed;
      if (Math.abs(signed) > maxFlowAbs) maxFlowAbs = Math.abs(signed);
    }

    const vStart = sStart.declared_total_cents / 100;
    const vEnd = sEnd.declared_total_cents / 100;
    const r = modifiedDietz(vStart, vEnd, flowsInPeriod, periodDays);
    const maxFlowPct = vStart > 0 ? maxFlowAbs / vStart : 0;

    subPeriods.push({
      from: sStart.reference_date,
      to: sEnd.reference_date,
      days: periodDays,
      starting_value_brl: round2(vStart),
      ending_value_brl: round2(vEnd),
      net_cash_flow_brl: round2(netCf),
      period_return: r,
      flows_in_period: flowsInPeriod.length,
      max_flow_pct: maxFlowPct,
    });

    // Warning: large flow (> 30% of starting value)
    if (maxFlowPct > 0.3) {
      warnings.push(
        `Cash flow of R$ ${round2(maxFlowAbs)} in sub-period ${sStart.reference_date} → ${sEnd.reference_date} is ${Math.round(maxFlowPct * 100)}% of sub-period starting value; Modified Dietz may overstate or understate the period return.`,
      );
    }
    // Warning: sparse history (sub-period > 60 days with ≥ 3 flows)
    if (periodDays > 60 && flowsInPeriod.length >= 3) {
      warnings.push(
        `Sub-period ${sStart.reference_date} → ${sEnd.reference_date} has ${flowsInPeriod.length} cash flows over ${periodDays} days; Modified Dietz precision degrades with sparse snapshots. Consider importing XPerformance more frequently.`,
      );
    }
  }

  // Geometric chain
  let twrPeriod = 1;
  for (const sp of subPeriods) {
    twrPeriod *= 1 + sp.period_return;
  }
  twrPeriod = twrPeriod - 1;

  // Annualization
  let twrAnnualized: number | null = null;
  if (totalDays < 30) {
    warnings.push(
      `Period span is ${totalDays} days; annualized return omitted (statistically noisy).`,
    );
  } else if (totalDays > 0) {
    twrAnnualized = Math.pow(1 + twrPeriod, 365 / totalDays) - 1;
  }

  return {
    twr_period: twrPeriod,
    twr_annualized: twrAnnualized,
    sub_periods: subPeriods,
    warnings,
  };
}

type MwrCoreMath = Omit<
  MwrCore,
  "period_from" | "period_to" | "days" | "snapshots_used" | "cash_flows_used"
>;

function computeMwrCore(
  snaps: readonly SnapshotRow[],
  windowFlows: readonly CashFlowRow[],
  totalDays: number,
): MwrCoreMath {
  const firstDate = snaps[0]!.reference_date;
  const lastDate = snaps[snaps.length - 1]!.reference_date;
  const vFirst = snaps[0]!.declared_total_cents / 100;
  const vLast = snaps[snaps.length - 1]!.declared_total_cents / 100;

  // Signed cash flows from the investor's perspective:
  //   APORTE → -amount (investor pays into portfolio)
  //   RESGATE → +amount (investor receives from portfolio)
  //   INITIAL_NAV → -vFirst (synthetic initial investment)
  //   TERMINAL_NAV → +vLast (synthetic final withdrawal)
  const breakdown: MwrCashFlow[] = [];
  breakdown.push({
    date: firstDate,
    signed_brl: -vFirst,
    label: "INITIAL_NAV",
  });
  for (const f of windowFlows) {
    const amt = f.amount_cents / 100;
    if (f.kind === "APORTE") {
      breakdown.push({
        date: f.flow_date,
        signed_brl: -amt,
        label: "APORTE",
      });
    } else {
      breakdown.push({
        date: f.flow_date,
        signed_brl: amt,
        label: "RESGATE",
      });
    }
  }
  breakdown.push({
    date: lastDate,
    signed_brl: vLast,
    label: "TERMINAL_NAV",
  });

  const warnings: string[] = [];
  if (totalDays < 30) {
    warnings.push(
      `Period span is ${totalDays} days; annualized return omitted (statistically noisy).`,
    );
  }

  const irrFlows: IrrFlow[] = breakdown.map((b) => ({
    date: b.date,
    amount: b.signed_brl,
  }));
  const result = bisectIrr(irrFlows, firstDate);

  let mwrAnnualized: number | null = null;
  let mwrPeriod: number | null = null;
  if (result.converged && result.rate !== null) {
    mwrAnnualized = result.rate;
    if (totalDays > 0) {
      mwrPeriod = Math.pow(1 + result.rate, totalDays / 365) - 1;
    }
    // If totalDays < 30, suppress annualized per spec — period stays.
    if (totalDays < 30) {
      mwrAnnualized = null;
    }
  } else {
    warnings.push(
      "MWR bisection did not converge in the [-99%, 1000%] annualized range. Check for unusual cash flow patterns or report this as a bug.",
    );
  }

  return {
    mwr_period: mwrPeriod,
    mwr_annualized: mwrAnnualized,
    converged: result.converged,
    iterations: result.iterations,
    npv_at_solution: result.npvAtSolution,
    cash_flows_breakdown: breakdown,
    warnings,
  };
}
