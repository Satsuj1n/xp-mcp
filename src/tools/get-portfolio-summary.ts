import { z } from "zod";
import type { Database } from "better-sqlite3";
import { getDb } from "../storage/db.js";
import { listPositions } from "../storage/positions-repo.js";
import { getLastDeclaredImport } from "../storage/imports-repo.js";
import { listCashFlowsSince } from "../storage/cash-flows-repo.js";
import {
  computeCashFlowSummary,
  rollingWindow,
} from "../services/cash-flow-summary.js";
import {
  computePortfolioSummary,
  type PortfolioSummary,
} from "../services/portfolio-summary.js";

export const getPortfolioSummarySchema = z.object({});
export type GetPortfolioSummaryInput = z.infer<
  typeof getPortfolioSummarySchema
>;

export interface GetPortfolioSummaryDeps {
  db?: Database;
  /**
   * Optional clock injection — used by tests to make the rolling-12m
   * window deterministic. Defaults to `new Date()`.
   */
  now?: Date;
}

/**
 * Returns a single-call panorama of the portfolio:
 *  - totals (market value, invested, P&L)
 *  - per-class breakdown sorted by market value
 *  - top 5 positions
 *  - FGC coverage and maturity buckets
 *  - reconciliation gap vs the most recent XPerformance PDF declared total
 *  - cash flow summary (YTD + rolling 12m) when cash flows are imported
 *
 * No outbound HTTP. No inputs. Reads only the local DB.
 */
export async function getPortfolioSummary(
  _input: GetPortfolioSummaryInput,
  deps: GetPortfolioSummaryDeps = {},
): Promise<PortfolioSummary> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const asOfDate = now.toISOString().slice(0, 10);
  const { startDate: rollingStart } = rollingWindow(asOfDate);

  const positions = listPositions(db);
  const lastDeclared = getLastDeclaredImport(db);
  const cashFlowRows = listCashFlowsSince(db, rollingStart);
  const cashFlowSummary =
    cashFlowRows.length === 0
      ? null
      : computeCashFlowSummary(cashFlowRows, asOfDate);

  return computePortfolioSummary(positions, lastDeclared, cashFlowSummary);
}
