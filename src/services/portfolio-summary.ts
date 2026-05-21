import { round2 } from "./money.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AssetClass } from "../storage/schema.js";

export interface ByClassRow {
  asset_class: AssetClass;
  count: number;
  market_value_brl: number;
  pct_of_total: number;
  invested_brl: number | null;
  unrealized_pl_brl: number | null;
  unrealized_pl_pct: number | null;
}

/**
 * Aggregate positions into one row per asset_class, sorted by market_value desc.
 * Caller must pre-filter positions with market_value_cents != null.
 * Per-class P&L is computed over the subset where invested_cents != null;
 * if the subset is empty, all three P&L fields are null.
 */
export function aggregateByClass(positions: PositionRow[]): ByClassRow[] {
  const totalCents = positions.reduce(
    (s, p) => s + (p.market_value_cents ?? 0),
    0,
  );
  const byClass = new Map<
    AssetClass,
    {
      count: number;
      marketCents: number;
      investedCents: number;
      marketCentsForPl: number;
      hasInvested: boolean;
    }
  >();
  for (const p of positions) {
    if (p.market_value_cents == null) continue;
    const entry = byClass.get(p.asset_class) ?? {
      count: 0,
      marketCents: 0,
      investedCents: 0,
      marketCentsForPl: 0,
      hasInvested: false,
    };
    entry.count += 1;
    entry.marketCents += p.market_value_cents;
    if (p.invested_cents != null) {
      entry.investedCents += p.invested_cents;
      entry.marketCentsForPl += p.market_value_cents;
      entry.hasInvested = true;
    }
    byClass.set(p.asset_class, entry);
  }
  const rows: ByClassRow[] = Array.from(byClass.entries()).map(([cls, e]) => {
    let invested_brl: number | null = null;
    let unrealized_pl_brl: number | null = null;
    let unrealized_pl_pct: number | null = null;
    if (e.hasInvested) {
      invested_brl = round2(e.investedCents / 100);
      const plCents = e.marketCentsForPl - e.investedCents;
      unrealized_pl_brl = round2(plCents / 100);
      unrealized_pl_pct =
        e.investedCents > 0 ? plCents / e.investedCents : null;
    }
    return {
      asset_class: cls,
      count: e.count,
      market_value_brl: round2(e.marketCents / 100),
      pct_of_total: totalCents > 0 ? e.marketCents / totalCents : 0,
      invested_brl,
      unrealized_pl_brl,
      unrealized_pl_pct,
    };
  });
  rows.sort((a, b) => b.market_value_brl - a.market_value_brl);
  return rows;
}
