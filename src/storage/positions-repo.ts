import type { Database } from "better-sqlite3";
import type { ParsedPosition } from "../adapters/xp/csv-extract.js";
import type { AssetClass } from "./schema.js";

export interface UpsertOutcome {
  inserted: number;
  updated: number;
}

/**
 * Idempotent upsert keyed by (asset_class, external_id).
 * Returns counts so the import tool can report progress accurately.
 *
 * The two-step (count then upsert) lets us distinguish inserted vs updated rows
 * without parsing the `RETURNING` clause (which better-sqlite3 supports but is
 * annoying to type per dialect).
 */
export function upsertPositions(
  db: Database,
  rows: readonly ParsedPosition[],
  importId: number,
): UpsertOutcome {
  let inserted = 0;
  let updated = 0;

  const exists = db.prepare(
    "SELECT 1 FROM positions WHERE asset_class = ? AND external_id = ?",
  );

  const upsert = db.prepare(`
    INSERT INTO positions (
      asset_class, external_id, name,
      quantity, avg_price_cents, current_price_cents,
      invested_cents, market_value_cents,
      issuer, indexer, rate, maturity_date, has_fgc,
      last_imported_at, last_import_id
    ) VALUES (
      @asset_class, @external_id, @name,
      @quantity, @avg_price_cents, @current_price_cents,
      @invested_cents, @market_value_cents,
      @issuer, @indexer, @rate, @maturity_date, @has_fgc,
      datetime('now'), @import_id
    )
    ON CONFLICT (asset_class, external_id) DO UPDATE SET
      name = excluded.name,
      quantity = excluded.quantity,
      avg_price_cents = excluded.avg_price_cents,
      current_price_cents = excluded.current_price_cents,
      invested_cents = excluded.invested_cents,
      market_value_cents = excluded.market_value_cents,
      issuer = excluded.issuer,
      indexer = excluded.indexer,
      rate = excluded.rate,
      maturity_date = excluded.maturity_date,
      has_fgc = excluded.has_fgc,
      last_imported_at = datetime('now'),
      last_import_id = excluded.last_import_id
  `);

  const tx = db.transaction((batch: readonly ParsedPosition[]) => {
    for (const row of batch) {
      const wasThere = exists.get(row.asset_class, row.external_id);
      upsert.run({
        asset_class: row.asset_class,
        external_id: row.external_id,
        name: row.name,
        quantity: row.quantity,
        avg_price_cents: row.avg_price_cents,
        current_price_cents: row.current_price_cents,
        invested_cents: row.invested_cents,
        market_value_cents: row.market_value_cents,
        issuer: row.issuer,
        indexer: row.indexer,
        rate: row.rate,
        maturity_date: row.maturity_date,
        has_fgc: row.has_fgc == null ? null : row.has_fgc ? 1 : 0,
        import_id: importId,
      });
      if (wasThere) updated++;
      else inserted++;
    }
  });

  tx(rows);
  return { inserted, updated };
}

export interface PositionRow {
  id: number;
  asset_class: AssetClass;
  external_id: string;
  name: string;
  quantity: number | null;
  avg_price_cents: number | null;
  current_price_cents: number | null;
  invested_cents: number | null;
  market_value_cents: number | null;
  issuer: string | null;
  indexer: string | null;
  rate: string | null;
  maturity_date: string | null;
  has_fgc: number | null;
  last_imported_at: string;
}

export function listPositions(
  db: Database,
  filter?: { assetClass?: AssetClass },
): PositionRow[] {
  if (filter?.assetClass) {
    return db
      .prepare(
        "SELECT * FROM positions WHERE asset_class = ? ORDER BY market_value_cents DESC NULLS LAST",
      )
      .all(filter.assetClass) as PositionRow[];
  }
  return db
    .prepare(
      "SELECT * FROM positions ORDER BY market_value_cents DESC NULLS LAST",
    )
    .all() as PositionRow[];
}

export function createImportRecord(
  db: Database,
  args: {
    sourceType:
      | "csv_extract"
      | "pdf_xperformance"
      | "pdf_nota"
      | "csv_proventos";
    sourcePath: string;
    totalRows: number;
    declaredTotalCents?: number | null;
    referenceDate?: string | null;
  },
): number {
  const result = db
    .prepare(
      "INSERT INTO imports (source_type, source_path, rows_total, declared_total_cents, reference_date) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      args.sourceType,
      args.sourcePath,
      args.totalRows,
      args.declaredTotalCents ?? null,
      args.referenceDate ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function updateImportCounts(
  db: Database,
  importId: number,
  counts: {
    imported: number;
    updated: number;
    skipped: number;
    notes?: string;
  },
): void {
  db.prepare(
    `UPDATE imports
       SET rows_imported = ?, rows_updated = ?, rows_skipped = ?, notes = ?
     WHERE id = ?`,
  ).run(
    counts.imported,
    counts.updated,
    counts.skipped,
    counts.notes ?? null,
    importId,
  );
}
