import { z } from "zod";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { parseExtractCsv } from "../parsers/csv-extract.js";
import { getDb } from "../storage/db.js";
import {
  createImportRecord,
  updateImportCounts,
  upsertPositions,
} from "../storage/positions-repo.js";

export const importExtractCsvSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe(
      "Absolute path to a CSV exported from XP (Posicao Consolidada, Extrato, etc.).",
    ),
});

export type ImportExtractCsvInput = z.infer<typeof importExtractCsvSchema>;

export interface ImportExtractCsvResult {
  ok: boolean;
  import_id: number;
  source_path: string;
  total_rows: number;
  imported: number;
  updated: number;
  skipped: number;
  warnings: string[];
  preview: Array<{
    asset_class: string;
    external_id: string;
    name: string;
    quantity: number | null;
    market_value_brl: number | null;
  }>;
}

export async function importExtractCsv(
  input: ImportExtractCsvInput,
): Promise<ImportExtractCsvResult> {
  const filePath = resolve(input.file_path);
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const { positions, warnings, unrecognized_rows, total_rows } =
    parseExtractCsv(filePath);

  const db = getDb();
  const importId = createImportRecord(db, {
    sourceType: "csv_extract",
    sourcePath: filePath,
    totalRows: total_rows,
  });

  const { inserted, updated } = upsertPositions(db, positions, importId);

  updateImportCounts(db, importId, {
    imported: inserted,
    updated,
    skipped: unrecognized_rows,
    notes: warnings.length > 0 ? warnings.slice(0, 10).join("\n") : undefined,
  });

  return {
    ok: true,
    import_id: importId,
    source_path: filePath,
    total_rows,
    imported: inserted,
    updated,
    skipped: unrecognized_rows,
    warnings,
    preview: positions.slice(0, 5).map((p) => ({
      asset_class: p.asset_class,
      external_id: p.external_id,
      name: p.name,
      quantity: p.quantity,
      market_value_brl:
        p.market_value_cents != null ? p.market_value_cents / 100 : null,
    })),
  };
}
