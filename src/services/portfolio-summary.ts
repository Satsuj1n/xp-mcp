import { round2 } from "./money.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AssetClass } from "../storage/schema.js";
import type { LastDeclaredImport } from "../storage/imports-repo.js";

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

export interface TopPosition {
  asset_class: string;
  external_id: string;
  name: string;
  market_value_brl: number;
  pct_of_total: number;
}

/**
 * Top n positions by market_value_cents desc, with ties broken by external_id asc
 * for determinism. Caller is responsible for filtering positions with null mv.
 */
export function pickTopPositions(
  positions: PositionRow[],
  n: number,
  totalCents: number,
): TopPosition[] {
  const sorted = positions
    .filter((p) => p.market_value_cents != null)
    .slice()
    .sort((a, b) => {
      const mvDiff =
        (b.market_value_cents as number) - (a.market_value_cents as number);
      if (mvDiff !== 0) return mvDiff;
      return a.external_id.localeCompare(b.external_id);
    });
  return sorted.slice(0, n).map((p) => ({
    asset_class: p.asset_class,
    external_id: p.external_id,
    name: p.name,
    market_value_brl: round2((p.market_value_cents as number) / 100),
    pct_of_total:
      totalCents > 0 ? (p.market_value_cents as number) / totalCents : 0,
  }));
}

export interface Reconciliation {
  declared_total_brl: number;
  computed_total_brl: number;
  gap_brl: number;
  gap_pct: number;
  declared_reference_date: string;
  declared_imported_at: string;
  declared_source_path: string;
  is_stale: boolean;
}

/**
 * Compares the computed total against the most recent declared import.
 * `computedAsOf` is an ISO timestamp; only the date portion is compared.
 * Returns null when `lastDecl` is null.
 */
export function computeReconciliation(
  computedCents: number,
  computedAsOf: string,
  lastDecl: LastDeclaredImport | null,
): Reconciliation | null {
  if (lastDecl == null) return null;
  const gapCents = computedCents - lastDecl.declared_total_cents;
  const gapPct =
    lastDecl.declared_total_cents !== 0
      ? gapCents / lastDecl.declared_total_cents
      : 0;
  return {
    declared_total_brl: round2(lastDecl.declared_total_cents / 100),
    computed_total_brl: round2(computedCents / 100),
    gap_brl: round2(gapCents / 100),
    gap_pct: gapPct,
    declared_reference_date: lastDecl.reference_date,
    declared_imported_at: lastDecl.imported_at,
    declared_source_path: lastDecl.source_path,
    is_stale: lastDecl.reference_date < computedAsOf.slice(0, 10),
  };
}

export interface FgcCoverage {
  covered_brl: number;
  not_covered_brl: number;
  unknown_brl: number;
  covered_pct: number;
}

export function computeFgcCoverage(
  positions: PositionRow[],
  totalCents: number,
): FgcCoverage {
  let coveredC = 0,
    notCoveredC = 0,
    unknownC = 0;
  for (const p of positions) {
    if (p.market_value_cents == null) continue;
    if (p.has_fgc === 1) coveredC += p.market_value_cents;
    else if (p.has_fgc === 0) notCoveredC += p.market_value_cents;
    else unknownC += p.market_value_cents;
  }
  return {
    covered_brl: round2(coveredC / 100),
    not_covered_brl: round2(notCoveredC / 100),
    unknown_brl: round2(unknownC / 100),
    covered_pct: totalCents > 0 ? coveredC / totalCents : 0,
  };
}

export interface MaturityBuckets {
  short_brl: number;
  medium_brl: number;
  long_brl: number;
  no_maturity_brl: number;
  short_count: number;
  medium_count: number;
  long_count: number;
  no_maturity_count: number;
  /**
   * Positions whose maturity_date parsed cleanly but lies before the
   * horizon. Subset of `short_count` (past maturities are bucketed as short).
   */
  past_count: number;
  /**
   * Positions whose maturity_date is non-null but failed to parse (bad
   * format or invalid date). Subset of `no_maturity_count`.
   */
  malformed_count: number;
  horizon_from: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Bucket positions by time-to-maturity from the given horizon date.
 *   < 1y → short, 1-3y → medium, > 3y → long, null/malformed → no_maturity.
 * Past-maturity positions land in `short`. The caller is expected to emit
 * the warning about past/malformed in the orchestrator.
 */
export function computeMaturityBuckets(
  positions: PositionRow[],
  horizonFromDate: string,
): MaturityBuckets {
  const horizonMs = Date.parse(`${horizonFromDate}T00:00:00Z`);
  let shortC = 0,
    medC = 0,
    longC = 0,
    noC = 0;
  let shortN = 0,
    medN = 0,
    longN = 0,
    noN = 0;
  let pastN = 0,
    malformedN = 0;
  for (const p of positions) {
    if (p.market_value_cents == null) continue;
    const mv = p.market_value_cents;
    if (p.maturity_date == null) {
      noC += mv;
      noN += 1;
      continue;
    }
    if (!DATE_RE.test(p.maturity_date)) {
      noC += mv;
      noN += 1;
      malformedN += 1;
      continue;
    }
    const matMs = Date.parse(`${p.maturity_date}T00:00:00Z`);
    if (Number.isNaN(matMs)) {
      noC += mv;
      noN += 1;
      malformedN += 1;
      continue;
    }
    const days = (matMs - horizonMs) / DAY_MS;
    if (days < 365) {
      shortC += mv;
      shortN += 1;
      if (matMs < horizonMs) pastN += 1;
    } else if (days < 365 * 3) {
      medC += mv;
      medN += 1;
    } else {
      longC += mv;
      longN += 1;
    }
  }
  return {
    short_brl: round2(shortC / 100),
    medium_brl: round2(medC / 100),
    long_brl: round2(longC / 100),
    no_maturity_brl: round2(noC / 100),
    short_count: shortN,
    medium_count: medN,
    long_count: longN,
    no_maturity_count: noN,
    past_count: pastN,
    malformed_count: malformedN,
    horizon_from: horizonFromDate,
  };
}

export interface PlCoverage {
  positions_with_pl_count: number;
  positions_total: number;
}

export interface PortfolioSummary {
  total_market_value_brl: number;
  positions_count: number;
  computed_as_of: string;
  total_invested_brl: number;
  total_unrealized_pl_brl: number;
  total_unrealized_pl_pct: number | null;
  pl_coverage: PlCoverage;
  by_class: ByClassRow[];
  top_positions: TopPosition[];
  fgc_coverage: FgcCoverage;
  maturity_buckets: MaturityBuckets;
  reconciliation: Reconciliation | null;
  warnings: string[];
}

const TOP_N = 5;
const LARGE_GAP_THRESHOLD = 0.01;

export function computePortfolioSummary(
  allPositions: PositionRow[],
  lastDecl: LastDeclaredImport | null,
): PortfolioSummary {
  const warnings: string[] = [];

  // 1) Filter positions without market_value
  const withMv = allPositions.filter((p) => p.market_value_cents != null);
  const skipped = allPositions.length - withMv.length;
  if (skipped > 0) {
    warnings.push(
      `${skipped} position${skipped === 1 ? "" : "s"} skipped (no market value)`,
    );
  }

  // 2) Empty-state shortcut
  if (withMv.length === 0) {
    warnings.unshift(
      "No positions in database. Run import_xperformance_pdf or import_extract_csv first.",
    );
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const reconciliation = computeReconciliation(0, now, lastDecl);
    return {
      total_market_value_brl: 0,
      positions_count: 0,
      computed_as_of: now,
      total_invested_brl: 0,
      total_unrealized_pl_brl: 0,
      total_unrealized_pl_pct: null,
      pl_coverage: { positions_with_pl_count: 0, positions_total: 0 },
      by_class: [],
      top_positions: [],
      fgc_coverage: {
        covered_brl: 0,
        not_covered_brl: 0,
        unknown_brl: 0,
        covered_pct: 0,
      },
      maturity_buckets: {
        short_brl: 0,
        medium_brl: 0,
        long_brl: 0,
        no_maturity_brl: 0,
        short_count: 0,
        medium_count: 0,
        long_count: 0,
        no_maturity_count: 0,
        past_count: 0,
        malformed_count: 0,
        horizon_from: now.slice(0, 10),
      },
      reconciliation,
      warnings,
    };
  }

  // 3) Totals
  const totalCents = withMv.reduce(
    (s, p) => s + (p.market_value_cents as number),
    0,
  );
  const computedAsOf = withMv.reduce(
    (max, p) => (p.last_imported_at > max ? p.last_imported_at : max),
    withMv[0]!.last_imported_at,
  );
  const horizonFromDate = computedAsOf.slice(0, 10);

  // 4) P&L over subset
  const withInvested = withMv.filter((p) => p.invested_cents != null);
  const investedCents = withInvested.reduce(
    (s, p) => s + (p.invested_cents as number),
    0,
  );
  const marketForPlCents = withInvested.reduce(
    (s, p) => s + (p.market_value_cents as number),
    0,
  );
  const plCents = marketForPlCents - investedCents;
  const totalUnrealizedPlPct =
    investedCents > 0 ? plCents / investedCents : null;

  // 5) Sub-functions
  const by_class = aggregateByClass(withMv);
  const top_positions = pickTopPositions(withMv, TOP_N, totalCents);
  const fgc_coverage = computeFgcCoverage(withMv, totalCents);
  const maturity_buckets = computeMaturityBuckets(withMv, horizonFromDate);
  const reconciliation = computeReconciliation(
    totalCents,
    computedAsOf,
    lastDecl,
  );

  // 6) Conditional warnings
  if (reconciliation == null && lastDecl == null) {
    warnings.push(
      "No XPerformance PDF imported yet; reconciliation unavailable",
    );
  }
  if (reconciliation?.is_stale) {
    warnings.push(
      `Declared total dates from ${reconciliation.declared_reference_date}; computed reflects state as of ${horizonFromDate}`,
    );
  }
  if (
    reconciliation &&
    Math.abs(reconciliation.gap_pct) > LARGE_GAP_THRESHOLD
  ) {
    warnings.push(
      `Reconciliation gap is ${(reconciliation.gap_pct * 100).toFixed(2)}% (R$ ${reconciliation.gap_brl.toFixed(2)}); possible import miss`,
    );
  }

  // 7) Past-maturity & malformed-maturity counts → warnings
  // (counted inside computeMaturityBuckets in single pass; we just surface)
  const { past_count, malformed_count } = maturity_buckets;
  if (past_count > 0) {
    warnings.push(
      `${past_count} position${past_count === 1 ? "" : "s"} have past maturity (counted as short bucket)`,
    );
  }
  if (malformed_count > 0) {
    warnings.push(
      `${malformed_count} position${malformed_count === 1 ? "" : "s"} have malformed maturity_date (counted as no_maturity)`,
    );
  }

  return {
    total_market_value_brl: round2(totalCents / 100),
    positions_count: withMv.length,
    computed_as_of: computedAsOf,
    total_invested_brl: round2(investedCents / 100),
    total_unrealized_pl_brl: round2(plCents / 100),
    total_unrealized_pl_pct: totalUnrealizedPlPct,
    pl_coverage: {
      positions_with_pl_count: withInvested.length,
      positions_total: withMv.length,
    },
    by_class,
    top_positions,
    fgc_coverage,
    maturity_buckets,
    reconciliation,
    warnings,
  };
}
