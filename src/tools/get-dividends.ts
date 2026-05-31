import { z } from "zod";
import type { Database } from "better-sqlite3";
import { getDb } from "../storage/db.js";
import {
  listDividends,
  type DividendsFilters,
} from "../storage/dividends-repo.js";

export const getDividendsSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Filter by asset external_id (e.g. MXRF11)."),
  asset_class: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Filter by asset class (e.g. FII, ACAO)."),
  kind: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Filter by payout kind verbatim (e.g. DIVIDENDO, JCP, RENDIMENTO).",
    ),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD")
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive lower bound on pay_date."),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD")
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive upper bound on pay_date."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe(
      "Max rows to return (default 100, max 500). Sorted by pay_date DESC.",
    ),
});

export type GetDividendsInput = z.infer<typeof getDividendsSchema>;

export interface GetDividendsResult {
  filters: {
    ticker: string | null;
    asset_class: string | null;
    kind: string | null;
    date_from: string | null;
    date_to: string | null;
    limit: number;
  };
  count: number;
  rows: Array<{
    id: number;
    pay_date: string;
    ex_date: string | null;
    asset_class: string;
    ticker: string;
    kind: string;
    gross_brl: number;
    tax_brl: number;
    net_brl: number;
    import_id: number | null;
  }>;
}

export interface GetDividendsDeps {
  db?: Database;
}

export async function getDividends(
  input: GetDividendsInput,
  deps: GetDividendsDeps = {},
): Promise<GetDividendsResult> {
  const db = deps.db ?? getDb();

  const filters: DividendsFilters = {};
  if (input.ticker) filters.external_id = input.ticker;
  if (input.asset_class) filters.asset_class = input.asset_class;
  if (input.kind) filters.kind = input.kind;
  if (input.date_from) filters.date_from = input.date_from;
  if (input.date_to) filters.date_to = input.date_to;

  const rows = listDividends(db, filters, input.limit);

  return {
    filters: {
      ticker: input.ticker ?? null,
      asset_class: input.asset_class ?? null,
      kind: input.kind ?? null,
      date_from: input.date_from ?? null,
      date_to: input.date_to ?? null,
      limit: input.limit,
    },
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      pay_date: r.pay_date,
      ex_date: r.ex_date,
      asset_class: r.asset_class,
      ticker: r.external_id,
      kind: r.kind,
      gross_brl: r.gross_cents / 100,
      tax_brl: r.tax_cents / 100,
      net_brl: r.net_cents / 100,
      import_id: r.import_id,
    })),
  };
}
