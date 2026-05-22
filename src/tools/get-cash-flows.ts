import { z } from "zod";
import type { Database } from "better-sqlite3";
import { getDb } from "../storage/db.js";
import {
  listCashFlows,
  sumCashFlows,
  type CashFlowsFilters,
} from "../storage/cash-flows-repo.js";
import type { CashFlowKind } from "../adapters/xp/pdf-bank-extract.js";

export const getCashFlowsSchema = z.object({
  date_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD")
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive lower bound on flow_date."),
  date_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD")
    .optional()
    .describe("ISO date YYYY-MM-DD, inclusive upper bound on flow_date."),
  kind: z
    .enum(["APORTE", "RESGATE"])
    .optional()
    .describe("Filter by flow direction."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100)
    .describe(
      "Max rows to return (default 100, max 500). Sorted by flow_datetime DESC.",
    ),
});

export type GetCashFlowsInput = z.infer<typeof getCashFlowsSchema>;

export interface GetCashFlowsResult {
  filters: {
    date_from: string | null;
    date_to: string | null;
    kind: CashFlowKind | null;
    limit: number;
  };
  count: number;
  totals_brl: {
    aporte_total: number;
    resgate_total: number;
    net: number;
  };
  rows: Array<{
    id: number;
    flow_date: string;
    flow_datetime: string;
    kind: CashFlowKind;
    amount_brl: number;
    description: string;
    import_id: number;
  }>;
}

export interface GetCashFlowsDeps {
  db?: Database;
}

export async function getCashFlows(
  input: GetCashFlowsInput,
  deps: GetCashFlowsDeps = {},
): Promise<GetCashFlowsResult> {
  const db = deps.db ?? getDb();

  const filters: CashFlowsFilters = {};
  if (input.date_from) filters.date_from = input.date_from;
  if (input.date_to) filters.date_to = input.date_to;
  if (input.kind) filters.kind = input.kind;

  const rows = listCashFlows(db, filters, input.limit);
  const totals = sumCashFlows(db, filters);

  const aporte_total = totals.aporte_cents / 100;
  const resgate_total = totals.resgate_cents / 100;

  return {
    filters: {
      date_from: input.date_from ?? null,
      date_to: input.date_to ?? null,
      kind: input.kind ?? null,
      limit: input.limit,
    },
    count: rows.length,
    totals_brl: {
      aporte_total,
      resgate_total,
      net: aporte_total - resgate_total,
    },
    rows: rows.map((r) => ({
      id: r.id,
      flow_date: r.flow_date,
      flow_datetime: r.flow_datetime,
      kind: r.kind,
      amount_brl: r.amount_cents / 100,
      description: r.description,
      import_id: r.import_id,
    })),
  };
}
