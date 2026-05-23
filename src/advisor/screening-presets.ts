import type { ScreenCriteria } from "./screening.js";
import type { UniverseClass } from "./market-data/source.js";
import type { AdvisorProfile } from "./profile.js";

/**
 * Maps (objective, asset_class, top_n) → ScreenCriteria used by suggest_buys.
 *
 * This is the single opinionated decision in the v0.7 feature: how the
 * investor's stated objective is translated into screening filters and sort
 * order per asset class. The matrix is spec-locked (see v0.7 design spec §7);
 * any change here must update the spec and the corresponding tests.
 */
export function criteriaFor(
  objective: AdvisorProfile["objective"],
  cls: UniverseClass,
  top_n: number,
): ScreenCriteria {
  switch (objective) {
    case "income":
      switch (cls) {
        case "FII":
          return {
            sort_by: "dividend_yield",
            order: "desc",
            filters: {
              min_dividend_yield_pct: 6,
              max_pvp: 1.5,
              max_vacancy_pct: 15,
              min_market_cap_brl: 200_000_000,
            },
            limit: top_n,
          };
        case "ACAO":
          return {
            sort_by: "dividend_yield",
            order: "desc",
            filters: {
              min_dividend_yield_pct: 4,
              min_market_cap_brl: 1_000_000_000,
            },
            limit: top_n,
          };
        case "ETF":
          return {
            sort_by: "dividend_yield",
            order: "desc",
            filters: {
              min_dividend_yield_pct: 3,
              min_market_cap_brl: 100_000_000,
            },
            limit: top_n,
          };
      }
      break;
    case "growth":
      switch (cls) {
        case "FII":
          return {
            sort_by: "market_cap",
            order: "desc",
            filters: {
              min_market_cap_brl: 500_000_000,
              max_pvp: 1.2,
            },
            limit: top_n,
          };
        case "ACAO":
          return {
            sort_by: "roe",
            order: "desc",
            filters: {
              min_roe_pct: 10,
              min_market_cap_brl: 1_000_000_000,
            },
            limit: top_n,
          };
        case "ETF":
          return {
            sort_by: "price_change_30d",
            order: "desc",
            filters: {
              min_market_cap_brl: 500_000_000,
            },
            limit: top_n,
          };
      }
      break;
    case "balanced":
      switch (cls) {
        case "FII":
          return {
            sort_by: "dividend_yield",
            order: "desc",
            filters: {
              min_dividend_yield_pct: 4,
              max_pvp: 1.3,
              min_market_cap_brl: 300_000_000,
            },
            limit: top_n,
          };
        case "ACAO":
          return {
            sort_by: "roe",
            order: "desc",
            filters: {
              min_roe_pct: 5,
              min_market_cap_brl: 500_000_000,
              min_dividend_yield_pct: 2,
            },
            limit: top_n,
          };
        case "ETF":
          return {
            sort_by: "market_cap",
            order: "desc",
            filters: {
              min_market_cap_brl: 500_000_000,
            },
            limit: top_n,
          };
      }
      break;
  }
  // Exhaustiveness: TS narrows objective/cls to never if all cases covered.
  // This branch is defensive against runtime callers bypassing types.
  throw new Error(
    `criteriaFor: unsupported combination objective=${objective} cls=${cls}`,
  );
}
