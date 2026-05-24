import type { Database } from "better-sqlite3";

export interface SnapshotRow {
  reference_date: string; // YYYY-MM-DD
  declared_total_cents: number;
  import_id: number;
  imported_at: string; // YYYY-MM-DD HH:MM:SS
}

/**
 * Returns XPerformance imports as valuation snapshots, sorted by
 * reference_date ASC then imported_at DESC (defensive — if two imports
 * share a reference_date, the most recently imported wins).
 *
 * Filters require declared_total_cents AND reference_date to be NOT
 * NULL — other source_types are excluded.
 *
 * `periodFrom` and `periodTo` are inclusive ISO date bounds on
 * reference_date.
 */
export function listValuationSnapshots(
  db: Database,
  periodFrom?: string,
  periodTo?: string,
): SnapshotRow[] {
  const clauses: string[] = [
    "source_type = 'pdf_xperformance'",
    "declared_total_cents IS NOT NULL",
    "reference_date IS NOT NULL",
  ];
  const params: unknown[] = [];
  if (periodFrom) {
    clauses.push("reference_date >= ?");
    params.push(periodFrom);
  }
  if (periodTo) {
    clauses.push("reference_date <= ?");
    params.push(periodTo);
  }
  const sql = `
    SELECT reference_date, declared_total_cents, id AS import_id, imported_at
      FROM imports
     WHERE ${clauses.join(" AND ")}
     ORDER BY reference_date ASC, imported_at DESC, id DESC`;
  return db.prepare(sql).all(...params) as SnapshotRow[];
}

export interface LastDeclaredImport {
  id: number;
  declared_total_cents: number;
  reference_date: string;
  source_path: string;
  imported_at: string;
}

/**
 * Returns the most recent import that has a non-null declared_total_cents,
 * ordered by `imported_at` desc. Returns null when no such import exists.
 *
 * Used by get_portfolio_summary to compute the reconciliation gap.
 */
export function getLastDeclaredImport(db: Database): LastDeclaredImport | null {
  const row = db
    .prepare(
      `SELECT id, declared_total_cents, reference_date, source_path, imported_at
       FROM imports
       WHERE declared_total_cents IS NOT NULL
       ORDER BY imported_at DESC, id DESC
       LIMIT 1`,
    )
    .get() as
    | {
        id: number;
        declared_total_cents: number;
        reference_date: string | null;
        source_path: string;
        imported_at: string;
      }
    | undefined;
  if (!row) return null;
  // reference_date should not be null when declared_total_cents is set
  // (writer enforces this), but guard defensively.
  if (row.reference_date == null) return null;
  return {
    id: row.id,
    declared_total_cents: row.declared_total_cents,
    reference_date: row.reference_date,
    source_path: row.source_path,
    imported_at: row.imported_at,
  };
}
