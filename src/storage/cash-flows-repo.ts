import type { Database } from "better-sqlite3";
import type { ParsedCashFlow } from "../adapters/xp/pdf-bank-extract.js";

export interface CashFlowsInsertOutcome {
  inserted: number;
  skipped: number;
}

export interface CashFlowsFilters {
  date_from?: string;
  date_to?: string;
  kind?: "APORTE" | "RESGATE";
}

export interface CashFlowRow {
  id: number;
  flow_datetime: string;
  flow_date: string;
  kind: "APORTE" | "RESGATE";
  amount_cents: number;
  description: string;
  import_id: number;
}

export interface CashFlowsTotals {
  aporte_cents: number;
  resgate_cents: number;
}

/**
 * Insert cash flow rows with idempotency on (flow_datetime, amount_cents, kind).
 * Existing rows are silently skipped (counted in `skipped`).
 */
export function insertCashFlows(
  db: Database,
  rows: readonly ParsedCashFlow[],
  importId: number,
): CashFlowsInsertOutcome {
  let inserted = 0;
  let skipped = 0;

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO cash_flows
       (flow_datetime, flow_date, kind, amount_cents, description, import_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const r of rows) {
      const result = stmt.run(
        r.flow_datetime,
        r.flow_date,
        r.kind,
        r.amount_cents,
        r.description,
        importId,
      );
      if (result.changes === 1) inserted++;
      else skipped++;
    }
  });

  tx();
  return { inserted, skipped };
}

/**
 * List cash flow rows, ordered by flow_datetime DESC (id DESC as tiebreaker), paginated by `limit`.
 */
export function listCashFlows(
  db: Database,
  filters: CashFlowsFilters,
  limit: number,
): CashFlowRow[] {
  const { sql, params } = buildWhere(filters);
  return db
    .prepare(
      `SELECT id, flow_datetime, flow_date, kind, amount_cents, description, import_id
         FROM cash_flows
         ${sql}
         ORDER BY flow_datetime DESC, id DESC
         LIMIT ?`,
    )
    .all(...params, limit) as CashFlowRow[];
}

/**
 * Sum amount_cents grouped by kind over all rows matching `filters`.
 * Limit is intentionally ignored — totals reflect the whole result set.
 */
export function sumCashFlows(
  db: Database,
  filters: CashFlowsFilters,
): CashFlowsTotals {
  const { sql, params } = buildWhere(filters);
  const rows = db
    .prepare(
      `SELECT kind, COALESCE(SUM(amount_cents), 0) AS total
         FROM cash_flows
         ${sql}
         GROUP BY kind`,
    )
    .all(...params) as { kind: string; total: number }[];

  let aporte_cents = 0;
  let resgate_cents = 0;
  for (const r of rows) {
    if (r.kind === "APORTE") aporte_cents = r.total;
    else if (r.kind === "RESGATE") resgate_cents = r.total;
  }
  return { aporte_cents, resgate_cents };
}

function buildWhere(filters: CashFlowsFilters): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.date_from) {
    clauses.push("flow_date >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    clauses.push("flow_date <= ?");
    params.push(filters.date_to);
  }
  if (filters.kind) {
    clauses.push("kind = ?");
    params.push(filters.kind);
  }
  const sql = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return { sql, params };
}
