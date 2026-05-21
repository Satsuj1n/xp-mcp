import type { Database } from "better-sqlite3";
import { parseNotesForDeclared } from "./notes-backfill.js";

/**
 * Idempotent migration from schema v1 to v2.
 * - Adds `declared_total_cents` and `reference_date` columns to `imports`.
 * - Backfills both from any legacy `notes` strings that contain the v1 keys.
 * - Sets meta.schema_version = '2'.
 *
 * Safe to call multiple times: ALTER TABLE errors with "duplicate column"
 * are caught and ignored; backfill writes are deterministic.
 */
export function migrateV1ToV2(db: Database): void {
  const tx = db.transaction(() => {
    addColumnIfMissing(db, "imports", "declared_total_cents", "INTEGER");
    addColumnIfMissing(db, "imports", "reference_date", "TEXT");

    const rows = db
      .prepare("SELECT id, notes FROM imports WHERE notes IS NOT NULL")
      .all() as { id: number; notes: string }[];
    const update = db.prepare(
      "UPDATE imports SET declared_total_cents = ?, reference_date = ? WHERE id = ?",
    );
    for (const r of rows) {
      const parsed = parseNotesForDeclared(r.notes);
      if (
        parsed.declared_total_cents != null ||
        parsed.reference_date != null
      ) {
        update.run(parsed.declared_total_cents, parsed.reference_date, r.id);
      }
    }

    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')",
    ).run();
  });
  tx();
}

function addColumnIfMissing(
  db: Database,
  table: string,
  column: string,
  type: string,
): void {
  try {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(message)) {
      throw err;
    }
  }
}
