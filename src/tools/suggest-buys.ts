import { z } from "zod";
import { requireOutboundEnabled } from "../advisor/profile.js";
import { criteriaFor } from "../advisor/screening-presets.js";
import { calculateAllocationDrift } from "./calculate-allocation-drift.js";
import { screenAssets, type ScreenAssetsResult } from "./screen-assets.js";
import { getDb } from "../storage/db.js";
import { listPositions } from "../storage/positions-repo.js";
import {
  composeSuggestions,
  type ScreenableClass,
  type SuggestBuysResult,
} from "../services/suggest-buys.js";
import { BrapiSource } from "../advisor/market-data/brapi.js";
import { MarketDataCache } from "../advisor/market-data/cache.js";
import type { MarketDataSource } from "../advisor/market-data/source.js";

const SCREENABLE: readonly ScreenableClass[] = ["FII", "ACAO", "ETF"];

function isScreenable(cls: string): cls is ScreenableClass {
  return (SCREENABLE as readonly string[]).includes(cls);
}

export const suggestBuysSchema = z.object({
  top_n: z
    .number()
    .int()
    .min(1)
    .max(5)
    .default(3)
    .describe(
      "Number of ticker suggestions per underweight asset class. " +
        "Each suggestion gets amount_brl = class_gap / top_n (even split). " +
        "Default 3 (diversifies without dispersing). Range 1-5.",
    ),
  target_path: z
    .string()
    .optional()
    .describe(
      "Absolute path to target allocation JSON. Defaults to ~/.xp-mcp/allocation.json. " +
        "Forwarded to calculate_allocation_drift verbatim.",
    ),
});

export type SuggestBuysInput = z.infer<typeof suggestBuysSchema>;

export interface SuggestBuysDeps {
  source?: MarketDataSource;
  cache?: MarketDataCache;
}

/**
 * Orchestrator: composes profile + drift + per-class screen + owned tickers
 * into a deterministic list of buy suggestions.
 *
 * - Requires outbound_enabled (calls screen_assets which fetches brapi).
 * - top_n controls suggestions per underweight screenable class.
 * - Non-screenable classes (TESOURO, RF, FUNDO) surface in skipped_classes.
 */
export async function suggestBuys(
  input: SuggestBuysInput,
  deps: SuggestBuysDeps = {},
): Promise<SuggestBuysResult> {
  const profile = await requireOutboundEnabled();
  const source = deps.source ?? new BrapiSource({ token: profile.brapi_token });
  const cache = deps.cache ?? new MarketDataCache(getDb());

  const top_n = input.top_n ?? 3;
  const drift = await calculateAllocationDrift({
    target_path: input.target_path,
  });

  const screensByClass = new Map<ScreenableClass, ScreenAssetsResult>();
  for (const row of drift.drift) {
    if (row.status !== "underweight") continue;
    if (row.action == null || row.action.side !== "BUY") continue;
    const cls = row.asset_class;
    if (!isScreenable(cls)) continue;
    const criteria = criteriaFor(profile.objective, cls, top_n);
    const screen = await screenAssets(
      {
        asset_class: cls,
        criteria,
        exclude_tickers: [],
      },
      { source, cache },
    );
    screensByClass.set(cls, screen);
  }

  const positions = listPositions(getDb());
  // PositionRow uses `external_id` as the ticker identifier (legacy field name
  // from the import schema; the values are tickers like "MXRF11", "BBAS3").
  const ownedTickers = new Set(positions.map((p) => p.external_id));

  return composeSuggestions(drift, screensByClass, ownedTickers, top_n);
}
