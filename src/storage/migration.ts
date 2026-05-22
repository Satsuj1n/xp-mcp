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

/**
 * Idempotent migration from schema v2 to v3.
 * - Creates the `cash_flows` table (capital flows between digital account and
 *   investment account: APORTE / RESGATE).
 * - Creates supporting indexes on flow_date and kind.
 * - Sets meta.schema_version = '3'.
 *
 * Safe to call multiple times: all DDL uses IF NOT EXISTS; no data is touched.
 */
export function migrateV2ToV3(db: Database): void {
  const STATEMENTS = [
    `CREATE TABLE IF NOT EXISTS cash_flows (
       id             INTEGER PRIMARY KEY AUTOINCREMENT,
       flow_datetime  TEXT    NOT NULL,
       flow_date      TEXT    NOT NULL,
       kind           TEXT    NOT NULL,
       amount_cents   INTEGER NOT NULL,
       description    TEXT    NOT NULL,
       import_id      INTEGER REFERENCES imports(id),
       UNIQUE (flow_datetime, amount_cents, kind)
     )`,
    `CREATE INDEX IF NOT EXISTS idx_cash_flows_date ON cash_flows(flow_date)`,
    `CREATE INDEX IF NOT EXISTS idx_cash_flows_kind ON cash_flows(kind)`,
  ];
  const tx = db.transaction(() => {
    for (const sql of STATEMENTS) db.prepare(sql).run();
    db.prepare(
      "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '3')",
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
