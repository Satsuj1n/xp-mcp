import { z } from "zod";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import { parseXPerformancePdf } from "../adapters/xp/pdf-xperformance.js";
import { getDb } from "../storage/db.js";
import {
  createImportRecord,
  updateImportCounts,
  upsertPositions,
} from "../storage/positions-repo.js";
import type { ParsedPosition } from "../adapters/xp/csv-extract.js";

export const importXperformancePdfSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe(
      "Absolute path to the XPerformance PDF (XP's official portfolio report).",
    ),
});

export type ImportXperformancePdfInput = z.infer<
  typeof importXperformancePdfSchema
>;

export interface ImportXperformancePdfResult {
  ok: boolean;
  import_id: number;
  source_path: string;
  reference_date: string | null;
  patrimonio_total_brl: number | null;
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
    pct_allocation: number | null;
  }>;
}

export async function importXperformancePdf(
  input: ImportXperformancePdfInput,
): Promise<ImportXperformancePdfResult> {
  const filePath = resolve(input.file_path);
  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const parsed = await parseXPerformancePdf(filePath);

  // Adapt XPerformance position shape to the generic ParsedPosition shape
  // used by the storage layer. Fields the PDF doesn't carry (avg_price,
  // invested) stay null — see classifyAsset for FGC inference.
  const positions: ParsedPosition[] = parsed.positions.map((p) => ({
    asset_class: p.asset_class,
    external_id: p.external_id,
    name: p.name,
    quantity: p.quantity,
    avg_price_cents: null,
    current_price_cents: p.current_price_cents,
    invested_cents: null,
    market_value_cents: p.market_value_cents,
    issuer: p.issuer,
    indexer: p.indexer,
    rate: p.rate,
    maturity_date: p.maturity_date,
    has_fgc: inferFgcForClass(p.asset_class),
  }));

  const db = getDb();
  const importId = createImportRecord(db, {
    sourceType: "pdf_xperformance",
    sourcePath: filePath,
    totalRows: parsed.total_rows,
  });

  const { inserted, updated } = upsertPositions(db, positions, importId);

  const notes = [
    parsed.reference_date && `reference_date=${parsed.reference_date}`,
    parsed.patrimonio_total_cents != null &&
      `patrimonio_total_cents=${parsed.patrimonio_total_cents}`,
    parsed.warnings.length > 0 && parsed.warnings.slice(0, 10).join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
  updateImportCounts(db, importId, {
    imported: inserted,
    updated,
    skipped: parsed.unrecognized_rows,
    notes: notes.length > 0 ? notes : undefined,
  });

  return {
    ok: true,
    import_id: importId,
    source_path: filePath,
    reference_date: parsed.reference_date,
    patrimonio_total_brl:
      parsed.patrimonio_total_cents != null
        ? parsed.patrimonio_total_cents / 100
        : null,
    total_rows: parsed.total_rows,
    imported: inserted,
    updated,
    skipped: parsed.unrecognized_rows,
    warnings: parsed.warnings,
    preview: parsed.positions.slice(0, 10).map((p) => ({
      asset_class: p.asset_class,
      external_id: p.external_id,
      name: p.name,
      quantity: p.quantity,
      market_value_brl:
        p.market_value_cents != null ? p.market_value_cents / 100 : null,
      pct_allocation: p.pct_allocation,
    })),
  };
}

function inferFgcForClass(ac: ParsedPosition["asset_class"]): boolean | null {
  if (ac === "RENDA_FIXA_PRIVADA") return true;
  if (ac === "TESOURO") return false;
  return null;
}
