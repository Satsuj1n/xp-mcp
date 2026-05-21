import { z } from "zod";
import { AdvisorError } from "../advisor/errors.js";
import { requireOutboundEnabled } from "../advisor/profile.js";
import { BrapiSource } from "../advisor/market-data/brapi.js";
import { MarketDataCache } from "../advisor/market-data/cache.js";
import type {
  Fundamentals,
  MarketDataSource,
  Quote,
  UniverseClass,
  UniverseListItem,
} from "../advisor/market-data/source.js";
import {
  screen,
  type Candidate,
  type ScreenResult,
} from "../advisor/screening.js";
import { getDb } from "../storage/db.js";
import { DISCLAIMER } from "./get-market-data.js";

const universeClassEnum = z.enum(["FII", "ACAO", "ETF"]);
const sortFieldEnum = z.enum([
  "dividend_yield",
  "pvp",
  "pl",
  "roe",
  "price_change_30d",
  "market_cap",
]);

export const screenAssetsSchema = z.object({
  asset_class: universeClassEnum.describe(
    "Universe to screen. FII = fundos imobiliários; ACAO = stocks; ETF = ETFs. " +
      "TESOURO/RF/FUNDO not supported in v0.4 (no brapi coverage).",
  ),
  criteria: z.object({
    sort_by: sortFieldEnum,
    order: z.enum(["asc", "desc"]).default("desc"),
    filters: z
      .object({
        min_market_cap_brl: z.number().nonnegative().optional(),
        max_pvp: z.number().nonnegative().optional(),
        min_dividend_yield_pct: z.number().nonnegative().optional(),
        min_roe_pct: z.number().optional(),
        max_vacancy_pct: z.number().nonnegative().optional(),
      })
      .default({}),
    limit: z.number().int().positive().max(50).default(10),
  }),
  exclude_tickers: z.array(z.string().regex(/^[A-Z0-9]{4,6}$/)).default([]),
});

export type ScreenAssetsInput = z.infer<typeof screenAssetsSchema>;

export interface ScreenAssetsResult {
  ok: boolean;
  asset_class: UniverseClass;
  universe_size: number;
  filtered_size: number;
  returned: number;
  results: ScreenResult[];
  warnings: string[];
}

export interface ScreenAssetsDeps {
  source?: MarketDataSource;
  cache?: MarketDataCache;
}

const UNIVERSE_TTL_MIN = 60 * 24 * 7; // 7 days
const QUOTE_TTL_MIN = 60; // 1 hour
const FUNDAMENTALS_TTL_MIN = 60 * 24; // 24 hours
const UNIVERSE_CACHE_KEY = "__UNIVERSE__"; // ticker slot reused as a cache key per asset class

export async function screenAssets(
  input: ScreenAssetsInput,
  deps: ScreenAssetsDeps = {},
): Promise<ScreenAssetsResult> {
  const profile = await requireOutboundEnabled();
  const source = deps.source ?? new BrapiSource({ token: profile.brapi_token });
  const cache = deps.cache ?? new MarketDataCache(getDb());

  // Universe (cached per asset_class via the universe_<CLASS> pseudo-ticker)
  const universeKey = `${UNIVERSE_CACHE_KEY}${input.asset_class}`;
  const cachedUniverse = cache.get<UniverseListItem[]>(
    universeKey,
    "universe",
    UNIVERSE_TTL_MIN,
  );
  let universe: UniverseListItem[];
  if (cachedUniverse) {
    universe = cachedUniverse.data;
  } else {
    universe = await source.listUniverse(input.asset_class);
    cache.put(universeKey, "universe", universe);
  }

  const warnings: string[] = [DISCLAIMER];

  // Profile-level exclusions: class + tickers
  if (profile.excluded_classes.includes(input.asset_class)) {
    warnings.push(
      `Profile excludes asset_class=${input.asset_class}; returning empty result.`,
    );
    return {
      ok: true,
      asset_class: input.asset_class,
      universe_size: universe.length,
      filtered_size: 0,
      returned: 0,
      results: [],
      warnings,
    };
  }
  const excludedTickers = new Set<string>([
    ...profile.excluded_tickers,
    ...input.exclude_tickers,
  ]);

  // Fetch quote + fundamentals for every non-excluded universe item, cached per ticker
  const candidates: Candidate[] = [];
  for (const item of universe) {
    if (excludedTickers.has(item.ticker)) continue;
    try {
      const cachedQuote = cache.get<Quote>(item.ticker, "quote", QUOTE_TTL_MIN);
      const quote =
        cachedQuote?.data ??
        (await (async () => {
          const fresh = await source.getQuote(item.ticker);
          cache.put(item.ticker, "quote", fresh);
          return fresh;
        })());
      const cachedF = cache.get<Fundamentals>(
        item.ticker,
        "fundamentals",
        FUNDAMENTALS_TTL_MIN,
      );
      const fundamentals =
        cachedF?.data ??
        (await (async () => {
          const fresh = await source.getFundamentals(item.ticker);
          cache.put(item.ticker, "fundamentals", fresh);
          return fresh;
        })());
      candidates.push({ ticker: item.ticker, quote, fundamentals });
    } catch (e) {
      const msg =
        e instanceof AdvisorError
          ? `${e.code}: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      warnings.push(`${item.ticker} unavailable — ${msg}`);
    }
  }

  // Pure screening
  const ranked = screen({
    candidates,
    criteria: input.criteria,
    excluded_tickers: [], // already pre-filtered above
  });

  // filtered_size = candidates that passed filters, before limit. Recompute via screen() with limit=∞.
  const beforeLimit = screen({
    candidates,
    criteria: { ...input.criteria, limit: Number.MAX_SAFE_INTEGER },
    excluded_tickers: [],
  });

  return {
    ok: true,
    asset_class: input.asset_class,
    universe_size: universe.length,
    filtered_size: beforeLimit.length,
    returned: ranked.length,
    results: ranked,
    warnings,
  };
}
