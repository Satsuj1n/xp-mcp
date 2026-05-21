import type { Database } from "better-sqlite3";

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
