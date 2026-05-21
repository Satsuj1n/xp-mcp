import { z } from "zod";
import type { Database } from "better-sqlite3";
import { getDb } from "../storage/db.js";
import { listPositions } from "../storage/positions-repo.js";
import { getLastDeclaredImport } from "../storage/imports-repo.js";
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
}

/**
 * Returns a single-call panorama of the portfolio:
 *  - totals (market value, invested, P&L)
 *  - per-class breakdown sorted by market value
 *  - top 5 positions
 *  - FGC coverage and maturity buckets
 *  - reconciliation gap vs the most recent XPerformance PDF declared total
 *
 * No outbound HTTP. No inputs. Reads only the local DB.
 */
export async function getPortfolioSummary(
  _input: GetPortfolioSummaryInput,
  deps: GetPortfolioSummaryDeps = {},
): Promise<PortfolioSummary> {
  const db = deps.db ?? getDb();
  const positions = listPositions(db);
  const lastDeclared = getLastDeclaredImport(db);
  return computePortfolioSummary(positions, lastDeclared);
}
