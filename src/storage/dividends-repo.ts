import type { Database } from "better-sqlite3";

export interface DividendsFilters {
  /** Match a single asset by its external_id (e.g. "MXRF11"). */
  external_id?: string;
  /** Match an asset class (e.g. "FII", "ACAO"). */
  asset_class?: string;
  /** Match the payout kind verbatim (e.g. "DIVIDENDO", "JCP", "RENDIMENTO"). */
  kind?: string;
  /** Inclusive lower bound on pay_date (ISO YYYY-MM-DD). */
  date_from?: string;
  /** Inclusive upper bound on pay_date (ISO YYYY-MM-DD). */
  date_to?: string;
}

export interface DividendRow {
  id: number;
  pay_date: string;
  ex_date: string | null;
  asset_class: string;
  external_id: string;
  kind: string;
  gross_cents: number;
  tax_cents: number;
  net_cents: number;
  import_id: number | null;
}

/**
 * List dividend/JCP rows, newest first (pay_date DESC, id DESC as tiebreaker),
 * paginated by `limit`. Read-only: rows are populated by the (deferred) annual
 * income-statement importer; this query stays valid whether the table is empty
 * or not.
 */
export function listDividends(
  db: Database,
  filters: DividendsFilters,
  limit: number,
): DividendRow[] {
  const { sql, params } = buildWhere(filters);
  return db
    .prepare(
      `SELECT id, pay_date, ex_date, asset_class, external_id, kind,
              gross_cents, tax_cents, net_cents, import_id
         FROM dividends
         ${sql}
         ORDER BY pay_date DESC, id DESC
         LIMIT ?`,
    )
    .all(...params, limit) as DividendRow[];
}

function buildWhere(filters: DividendsFilters): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.external_id) {
    clauses.push("external_id = ?");
    params.push(filters.external_id);
  }
  if (filters.asset_class) {
    clauses.push("asset_class = ?");
    params.push(filters.asset_class);
  }
  if (filters.kind) {
    clauses.push("kind = ?");
    params.push(filters.kind);
  }
  if (filters.date_from) {
    clauses.push("pay_date >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    clauses.push("pay_date <= ?");
    params.push(filters.date_to);
  }
  const sql = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return { sql, params };
}
