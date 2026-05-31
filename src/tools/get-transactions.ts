import { z } from "zod";
import type { Database } from "better-sqlite3";
import { getDb } from "../storage/db.js";
import {
  listTransactions,
  type TransactionsFilters,
} from "../storage/transactions-repo.js";

export const getTransactionsSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Filter by asset external_id (e.g. BBAS3)."),
  asset_class: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Filter by asset class (e.g. ACAO, FII)."),
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD")
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive lower bound on trade_date."),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD")
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive upper bound on trade_date."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe(
      "Max rows to return (default 100, max 500). Sorted by trade_date DESC.",
    ),
});

export type GetTransactionsInput = z.infer<typeof getTransactionsSchema>;

export interface GetTransactionsResult {
  filters: {
    ticker: string | null;
    asset_class: string | null;
    date_from: string | null;
    date_to: string | null;
    limit: number;
  };
  count: number;
  rows: Array<{
    id: number;
    trade_date: string;
    settle_date: string | null;
    asset_class: string;
    ticker: string;
    side: string;
    quantity: number;
    price_brl: number;
    fees_brl: number;
    total_brl: number;
    broker_note_id: string | null;
    import_id: number | null;
  }>;
}

export interface GetTransactionsDeps {
  db?: Database;
}

export async function getTransactions(
  input: GetTransactionsInput,
  deps: GetTransactionsDeps = {},
): Promise<GetTransactionsResult> {
  const db = deps.db ?? getDb();

  const filters: TransactionsFilters = {};
  if (input.ticker) filters.external_id = input.ticker;
  if (input.asset_class) filters.asset_class = input.asset_class;
  if (input.date_from) filters.date_from = input.date_from;
  if (input.date_to) filters.date_to = input.date_to;

  const rows = listTransactions(db, filters, input.limit);

  return {
    filters: {
      ticker: input.ticker ?? null,
      asset_class: input.asset_class ?? null,
      date_from: input.date_from ?? null,
      date_to: input.date_to ?? null,
      limit: input.limit,
    },
    count: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      trade_date: r.trade_date,
      settle_date: r.settle_date,
      asset_class: r.asset_class,
      ticker: r.external_id,
      side: r.side,
      quantity: r.quantity,
      price_brl: r.price_cents / 100,
      fees_brl: r.fees_cents / 100,
      total_brl: r.total_cents / 100,
      broker_note_id: r.broker_note_id,
      import_id: r.import_id,
    })),
  };
}
