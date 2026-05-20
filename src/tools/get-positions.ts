import { z } from "zod";
import { getDb } from "../storage/db.js";
import { listPositions } from "../storage/positions-repo.js";
import { ASSET_CLASSES } from "../storage/schema.js";

export const getPositionsSchema = z.object({
  asset_class: z
    .enum(ASSET_CLASSES)
    .optional()
    .describe(
      "Filter by a single asset class. Omit to list all positions. " +
        "Allowed values: " +
        ASSET_CLASSES.join(", "),
    ),
});

export type GetPositionsInput = z.infer<typeof getPositionsSchema>;

export interface PositionView {
  asset_class: string;
  external_id: string;
  name: string;
  quantity: number | null;
  avg_price_brl: number | null;
  current_price_brl: number | null;
  invested_brl: number | null;
  market_value_brl: number | null;
  unrealized_pl_brl: number | null;
  unrealized_pl_pct: number | null;
  issuer: string | null;
  indexer: string | null;
  rate: string | null;
  maturity_date: string | null;
  has_fgc: boolean | null;
  last_imported_at: string;
}

export interface GetPositionsResult {
  count: number;
  total_market_value_brl: number;
  positions: PositionView[];
}

function centsToBrl(cents: number | null): number | null {
  return cents == null ? null : cents / 100;
}

export async function getPositions(
  input: GetPositionsInput,
): Promise<GetPositionsResult> {
  const db = getDb();
  const rows = listPositions(db, { assetClass: input.asset_class });

  const positions: PositionView[] = rows.map((r) => {
    const invested = r.invested_cents;
    const market = r.market_value_cents;
    const pl = invested != null && market != null ? market - invested : null;
    const plPct =
      invested != null && market != null && invested !== 0
        ? ((market - invested) / invested) * 100
        : null;

    return {
      asset_class: r.asset_class,
      external_id: r.external_id,
      name: r.name,
      quantity: r.quantity,
      avg_price_brl: centsToBrl(r.avg_price_cents),
      current_price_brl: centsToBrl(r.current_price_cents),
      invested_brl: centsToBrl(invested),
      market_value_brl: centsToBrl(market),
      unrealized_pl_brl: centsToBrl(pl),
      unrealized_pl_pct: plPct,
      issuer: r.issuer,
      indexer: r.indexer,
      rate: r.rate,
      maturity_date: r.maturity_date,
      has_fgc: r.has_fgc == null ? null : r.has_fgc === 1,
      last_imported_at: r.last_imported_at,
    };
  });

  const totalCents = rows.reduce(
    (sum, r) => sum + (r.market_value_cents ?? 0),
    0,
  );

  return {
    count: positions.length,
    total_market_value_brl: totalCents / 100,
    positions,
  };
}
