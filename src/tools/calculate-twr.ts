import { z } from "zod";
import type { Database } from "better-sqlite3";
import { getDb } from "../storage/db.js";
import { listValuationSnapshots } from "../storage/imports-repo.js";
import { listCashFlowsSince } from "../storage/cash-flows-repo.js";
import {
  computeTwr,
  daysBetween,
  type TwrSubPeriod,
} from "../services/returns.js";

export const calculateTwrSchema = z.object({
  period_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  period_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CalculateTwrInput = z.infer<typeof calculateTwrSchema>;

export interface TwrResult {
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

export interface CalculateTwrDeps {
  db?: Database;
  /**
   * Optional clock injection — used by tests and the stale-tail warning
   * computation. Defaults to `new Date()`.
   */
  now?: Date;
}

/**
 * Thrown when fewer than 2 XPerformance valuation snapshots are
 * available in the requested window. Re-exported (and re-used) by the
 * MWR tool wrapper.
 */
export class InsufficientHistoryError extends Error {
  constructor(found: number) {
    super(
      `Need at least 2 XPerformance imports to compute returns. Found ${found}. ` +
        `Import another XPerformance PDF (or pass an earlier period_from / later period_to that covers ≥ 2 imports).`,
    );
    this.name = "InsufficientHistoryError";
  }
}

/**
 * Compute the time-weighted return (TWR) over the XPerformance import
 * history. Modified Dietz per sub-period (between consecutive imports)
 * chained geometrically.
 *
 * Throws `InsufficientHistoryError` when fewer than 2 snapshots are
 * available in the requested window. `src/index.ts` wraps thrown errors
 * into `isError: true` MCP responses, so callers see a structured error
 * message rather than a crashed tool.
 *
 * Emits a stale-tail warning when `period_to` was not provided AND the
 * latest snapshot is > 60 days older than `deps.now`.
 */
export async function calculateTwr(
  input: CalculateTwrInput,
  deps: CalculateTwrDeps = {},
): Promise<TwrResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();

  const snapshots = listValuationSnapshots(
    db,
    input.period_from,
    input.period_to,
  );
  if (snapshots.length < 2) {
    throw new InsufficientHistoryError(snapshots.length);
  }

  // Load cash flows from the first snapshot's date onward; the pure
  // service filters defensively to its own window (inclusive on both
  // ends — see services/returns.ts § computeReturns).
  const firstDate = snapshots[0]!.reference_date;
  const cashFlows = listCashFlowsSince(db, firstDate);

  const core = computeTwr(snapshots, cashFlows);

  // Tool-layer warning: stale tail. Only fires when period_to is
  // implicit (defaulted to the last snapshot). Threshold: > 60 days
  // between the last snapshot and `now`.
  const warnings = [...core.warnings];
  if (input.period_to == null) {
    const nowDate = now.toISOString().slice(0, 10);
    const daysSinceLast = daysBetween(core.period_to, nowDate);
    if (daysSinceLast > 60) {
      warnings.push(
        `Last snapshot is from ${core.period_to}; latest portfolio state may be significantly different. Import a fresh XPerformance to refresh.`,
      );
    }
  }

  return {
    period_from: core.period_from,
    period_to: core.period_to,
    days: core.days,
    snapshots_used: core.snapshots_used,
    cash_flows_used: core.cash_flows_used,
    twr_period: core.twr_period,
    twr_annualized: core.twr_annualized,
    sub_periods: core.sub_periods,
    warnings,
  };
}
