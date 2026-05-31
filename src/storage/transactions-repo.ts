import type { Database } from "better-sqlite3";

export interface TransactionsFilters {
  /** Match a single asset by its external_id (e.g. "BBAS3"). */
  external_id?: string;
  /** Match an asset class (e.g. "ACAO", "FII"). */
  asset_class?: string;
  /** Inclusive lower bound on trade_date (ISO YYYY-MM-DD). */
  date_from?: string;
  /** Inclusive upper bound on trade_date (ISO YYYY-MM-DD). */
  date_to?: string;
}

export interface TransactionRow {
  id: number;
  trade_date: string;
  settle_date: string | null;
  asset_class: string;
  external_id: string;
  side: string;
  quantity: number;
  price_cents: number;
  fees_cents: number;
  total_cents: number;
  broker_note_id: string | null;
  import_id: number | null;
}

/**
 * List transaction rows, newest first (trade_date DESC, id DESC as tiebreaker),
 * paginated by `limit`. Read-only: rows are populated by the (deferred) broker
 * note importer; this query stays valid whether the table is empty or not.
 */
export function listTransactions(
  db: Database,
  filters: TransactionsFilters,
  limit: number,
): TransactionRow[] {
  const { sql, params } = buildWhere(filters);
  return db
    .prepare(
      `SELECT id, trade_date, settle_date, asset_class, external_id, side,
              quantity, price_cents, fees_cents, total_cents, broker_note_id, import_id
         FROM transactions
         ${sql}
         ORDER BY trade_date DESC, id DESC
         LIMIT ?`,
    )
    .all(...params, limit) as TransactionRow[];
}

function buildWhere(filters: TransactionsFilters): {
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
  if (filters.date_from) {
    clauses.push("trade_date >= ?");
    params.push(filters.date_from);
  }
  if (filters.date_to) {
    clauses.push("trade_date <= ?");
    params.push(filters.date_to);
  }
  const sql = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return { sql, params };
}
