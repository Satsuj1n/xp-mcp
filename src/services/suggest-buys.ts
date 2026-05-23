import type { DriftReport, DriftRow } from "./drift.js";
import type { ScreenAssetsResult } from "../tools/screen-assets.js";
import { round2 } from "./money.js";

export const DISCLAIMER =
  "[disclaimer] Análise educacional baseada em dados públicos. Não constitui recomendação de investimento. Decisões financeiras são de sua responsabilidade.";

export type ScreenableClass = "FII" | "ACAO" | "ETF";

const SCREENABLE: readonly ScreenableClass[] = ["FII", "ACAO", "ETF"];

function isScreenable(cls: string): cls is ScreenableClass {
  return (SCREENABLE as readonly string[]).includes(cls);
}

export interface BuySuggestion {
  asset_class: ScreenableClass;
  ticker: string;
  amount_brl: number;
  score: number;
  rationale: string;
  already_owned: boolean;
}

export interface SkippedClass {
  asset_class: string; // any non-screenable AssetClass from the drift
  underweight_brl: number;
  reason: string;
}

export interface SuggestBuysResult {
  ok: true;
  total_to_invest_brl: number;
  total_skipped_brl: number;
  suggestions: BuySuggestion[];
  skipped_classes: SkippedClass[];
  warnings: string[];
}

/**
 * Pure compose: given drift + per-class screen results + currently-owned
 * tickers, produces the suggest_buys output. No I/O.
 *
 * Contract:
 * - Only `underweight` rows from the drift produce output.
 * - Screenable classes (FII/ACAO/ETF) require an entry in screenResultsByClass
 *   to produce suggestions. Missing entry ⇒ silently skipped (caller mistake).
 * - Non-screenable classes go to skipped_classes with a fixed reason.
 * - amount_brl per suggestion = class_gap_brl / actual_returned (even split).
 * - actual_returned === 0 ⇒ warning, no suggestions for that class.
 * - DISCLAIMER is always the first entry in warnings.
 * - Drift warnings + screen warnings (excluding their leading DISCLAIMERs, to
 *   avoid duplication) are forwarded.
 */
export function composeSuggestions(
  drift: DriftReport,
  screenResultsByClass: Map<ScreenableClass, ScreenAssetsResult>,
  ownedTickers: Set<string>,
  top_n: number,
): SuggestBuysResult {
  void top_n; // currently unused: division uses actual_returned from screen result
  const suggestions: BuySuggestion[] = [];
  const skippedClasses: SkippedClass[] = [];
  const warnings: string[] = [DISCLAIMER];

  // Forward drift warnings (no DISCLAIMER expected there).
  for (const w of drift.warnings) warnings.push(w);

  const underweightRows = drift.drift.filter(
    (r): r is DriftRow & { action: { side: "BUY"; amount_brl: number } } =>
      r.status === "underweight" && r.action != null && r.action.side === "BUY",
  );

  if (drift.drift.length > 0 && underweightRows.length === 0) {
    warnings.push(
      "Portfolio is within tolerance for all classes; no buys suggested.",
    );
  }

  for (const row of underweightRows) {
    const cls = row.asset_class;
    const gapBrl = row.action.amount_brl;

    if (!isScreenable(cls)) {
      skippedClasses.push({
        asset_class: cls,
        underweight_brl: gapBrl,
        reason: `screening não cobre ${cls}; alocar manualmente.`,
      });
      continue;
    }

    const screen = screenResultsByClass.get(cls);
    if (!screen) continue; // missing screen entry: caller did not fetch it

    // Forward screen warnings except the leading DISCLAIMER (avoid duplicates).
    for (const w of screen.warnings) {
      if (w === DISCLAIMER) continue;
      warnings.push(w);
    }

    const actualReturned = screen.returned;
    if (actualReturned === 0) {
      warnings.push(
        `${cls} underweight by ${gapBrl.toFixed(2)} BRL but no tickers passed screening (universe=${screen.universe_size}, filtered=${screen.filtered_size}); relax filters or screen manually.`,
      );
      continue;
    }

    const amountPerTicker = round2(gapBrl / actualReturned);

    for (const result of screen.results) {
      suggestions.push({
        asset_class: cls,
        ticker: result.ticker,
        amount_brl: amountPerTicker,
        score: result.score,
        rationale: result.why,
        already_owned: ownedTickers.has(result.ticker),
      });
    }
  }

  const total_to_invest_brl = round2(
    suggestions.reduce((acc, s) => acc + s.amount_brl, 0),
  );
  const total_skipped_brl = round2(
    skippedClasses.reduce((acc, s) => acc + s.underweight_brl, 0),
  );

  return {
    ok: true,
    total_to_invest_brl,
    total_skipped_brl,
    suggestions,
    skipped_classes: skippedClasses,
    warnings,
  };
}
