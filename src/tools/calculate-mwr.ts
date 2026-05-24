import { z } from "zod";
import type { Database } from "better-sqlite3";
import { getDb } from "../storage/db.js";
import { listValuationSnapshots } from "../storage/imports-repo.js";
import { listCashFlowsSince } from "../storage/cash-flows-repo.js";
import {
  computeMwr,
  daysBetween,
  type MwrCashFlow,
} from "../services/returns.js";
import { InsufficientHistoryError } from "./calculate-twr.js";

export const calculateMwrSchema = z.object({
  period_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  period_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type CalculateMwrInput = z.infer<typeof calculateMwrSchema>;

export interface MwrResult {
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

export interface CalculateMwrDeps {
  db?: Database;
  /**
   * Optional clock injection — used by tests and the stale-tail warning
   * computation. Defaults to `new Date()`.
   */
  now?: Date;
}

/**
 * Compute the money-weighted return (MWR / IRR) over the XPerformance
 * import history. Bisection IRR over signed cash flows including
 * synthetic INITIAL_NAV and TERMINAL_NAV markers.
 *
 * Throws `InsufficientHistoryError` (shared with `calculate_twr`) when
 * fewer than 2 snapshots are available in the requested window.
 * `src/index.ts` wraps thrown errors into `isError: true` MCP responses,
 * so callers see a structured error message rather than a crashed tool.
 *
 * Returns `converged: false` (with `mwr_period: null`, `mwr_annualized:
 * null`, `npv_at_solution: null`) when bisection finds no sign change
 * in the `[-99%, +1000%]` annualized bracket — never throws for that.
 *
 * Emits a stale-tail warning when `period_to` was not provided AND the
 * latest snapshot is > 60 days older than `deps.now`.
 */
export async function calculateMwr(
  input: CalculateMwrInput,
  deps: CalculateMwrDeps = {},
): Promise<MwrResult> {
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

  const core = computeMwr(snapshots, cashFlows);

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
    mwr_period: core.mwr_period,
    mwr_annualized: core.mwr_annualized,
    converged: core.converged,
    iterations: core.iterations,
    npv_at_solution: core.npv_at_solution,
    cash_flows_breakdown: core.cash_flows_breakdown,
    warnings,
  };
}
