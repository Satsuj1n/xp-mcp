import { z } from "zod";
import { resolve } from "node:path";
import { statSync } from "node:fs";
import type { Database } from "better-sqlite3";
import {
  parseBankExtractPdf,
  type ParsedBankExtract,
  type CashFlowKind,
} from "../adapters/xp/pdf-bank-extract.js";
import { getDb } from "../storage/db.js";
import {
  createImportRecord,
  updateImportCounts,
} from "../storage/positions-repo.js";
import { insertCashFlows } from "../storage/cash-flows-repo.js";

export const importBankExtractPdfSchema = z.object({
  file_path: z
    .string()
    .min(1)
    .describe(
      "Absolute path to a PDF exported from XP's Conta Digital Extrato (digital account statement).",
    ),
});

export type ImportBankExtractPdfInput = z.infer<
  typeof importBankExtractPdfSchema
>;

export interface ImportBankExtractPdfResult {
  ok: true;
  import_id: number;
  source_path: string;
  period_from: string | null;
  period_to: string | null;
  total_lines: number;
  imported: number;
  skipped: number;
  ignored_lines: number;
  warnings: string[];
  preview: Array<{
    flow_date: string;
    flow_datetime: string;
    kind: CashFlowKind;
    amount_brl: number;
    description: string;
  }>;
}

export interface ImportBankExtractPdfDeps {
  db?: Database;
  /**
   * Override the parser — primarily for tests where reading a real PDF is
   * unnecessary. Production calls default to `parseBankExtractPdf`.
   */
  parser?: (filePath: string) => Promise<ParsedBankExtract>;
}

export async function importBankExtractPdf(
  input: ImportBankExtractPdfInput,
  deps: ImportBankExtractPdfDeps = {},
): Promise<ImportBankExtractPdfResult> {
  const filePath = resolve(input.file_path);

  const stat = statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }

  const parser = deps.parser ?? parseBankExtractPdf;
  const parsed = await parser(filePath);

  const db = deps.db ?? getDb();

  const importId = createImportRecord(db, {
    sourceType: "pdf_bank_extract",
    sourcePath: filePath,
    totalRows: parsed.total_lines,
    referenceDate: parsed.metadata.period_to,
  });

  const { inserted, skipped } = insertCashFlows(
    db,
    parsed.cash_flows,
    importId,
  );

  const notes =
    parsed.warnings.length > 0
      ? parsed.warnings.slice(0, 10).join("\n")
      : undefined;

  updateImportCounts(db, importId, {
    imported: inserted,
    updated: 0,
    skipped,
    notes,
  });

  return {
    ok: true,
    import_id: importId,
    source_path: filePath,
    period_from: parsed.metadata.period_from,
    period_to: parsed.metadata.period_to,
    total_lines: parsed.total_lines,
    imported: inserted,
    skipped,
    ignored_lines: parsed.ignored_lines,
    warnings: parsed.warnings,
    preview: parsed.cash_flows.slice(0, 10).map((f) => ({
      flow_date: f.flow_date,
      flow_datetime: f.flow_datetime,
      kind: f.kind,
      amount_brl: f.amount_cents / 100,
      description: f.description,
    })),
  };
}
