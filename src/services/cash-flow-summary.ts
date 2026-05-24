import { round2 } from "./money.js";
import type { CashFlowRow } from "../storage/cash-flows-repo.js";

export interface CashFlowSummary {
  as_of_date: string;
  total_records: number;
  ytd: {
    year: number;
    aporte_brl: number;
    resgate_brl: number;
    net_brl: number;
  };
  rolling_12m: {
    from_month: string;
    to_month: string;
    months_with_data: number;
    aporte_brl: number;
    resgate_brl: number;
    net_brl: number;
    monthly_avg_aporte_brl: number;
    monthly_avg_net_brl: number;
  };
}

/**
 * First day of the calendar year of `asOfDate`. Pure string slicing — no
 * Date parsing needed because ISO dates compare lexicographically.
 */
export function ytdStart(asOfDate: string): string {
  return `${asOfDate.slice(0, 4)}-01-01`;
}

/**
 * Derive the rolling-12-month window from `asOfDate`. The window ends on
 * `asOfDate`'s calendar month and starts on the first day of (month - 11).
 *
 * Pure modular arithmetic on month indices — no `Date` parsing, no
 * timezone surprises. Returns the start date (used to filter rows) and
 * the two month markers (used in the public output).
 */
export function rollingWindow(asOfDate: string): {
  fromMonth: string;
  toMonth: string;
  startDate: string;
} {
  const year = parseInt(asOfDate.slice(0, 4), 10);
  const month = parseInt(asOfDate.slice(5, 7), 10); // 1..12
  let fromMonthIdx = month - 11;
  let fromYear = year;
  if (fromMonthIdx < 1) {
    fromMonthIdx += 12;
    fromYear -= 1;
  }
  const fromMonth = `${fromYear}-${String(fromMonthIdx).padStart(2, "0")}`;
  const toMonth = `${year}-${String(month).padStart(2, "0")}`;
  return { fromMonth, toMonth, startDate: `${fromMonth}-01` };
}

/**
 * Compute YTD and rolling-12-month aggregates from cash flow rows.
 *
 * `asOfDate` is an ISO date `YYYY-MM-DD` anchoring both windows:
 *  - YTD: rows with flow_date in [`${year}-01-01`, asOfDate]
 *  - rolling 12m: rows with flow_date in [first day of (month-11), asOfDate]
 *
 * Caller is expected to have loaded rows since the rolling window start.
 * Rows outside the window are silently ignored — the service filters too,
 * defensively, so `total_records` reflects in-window rows only.
 *
 * `monthly_avg_*` divides by `months_with_data` (not 12) so a short
 * history is not penalised. When `months_with_data === 0`, averages are
 * 0 (no division by zero).
 */
export function computeCashFlowSummary(
  rows: readonly CashFlowRow[],
  asOfDate: string,
): CashFlowSummary {
  const year = parseInt(asOfDate.slice(0, 4), 10);
  const ytdFrom = ytdStart(asOfDate);
  const {
    fromMonth,
    toMonth,
    startDate: rollingStart,
  } = rollingWindow(asOfDate);

  // Accumulators in cents (integers — no float drift until round2 boundary).
  let ytdAporteCents = 0;
  let ytdResgateCents = 0;
  let rollAporteCents = 0;
  let rollResgateCents = 0;
  let totalRecords = 0;
  const monthsWithData = new Set<string>();

  for (const r of rows) {
    // Rolling window: lexicographic compare on ISO date strings.
    const inRolling = r.flow_date >= rollingStart && r.flow_date <= asOfDate;
    if (!inRolling) continue;

    totalRecords += 1;
    monthsWithData.add(r.flow_date.slice(0, 7));

    if (r.kind === "APORTE") rollAporteCents += r.amount_cents;
    else rollResgateCents += r.amount_cents;

    const inYtd = r.flow_date >= ytdFrom && r.flow_date <= asOfDate;
    if (inYtd) {
      if (r.kind === "APORTE") ytdAporteCents += r.amount_cents;
      else ytdResgateCents += r.amount_cents;
    }
  }

  const monthsCount = monthsWithData.size;
  const rollNetCents = rollAporteCents - rollResgateCents;
  const ytdNetCents = ytdAporteCents - ytdResgateCents;

  // Averages: divide cents by months first, then convert to BRL via round2.
  // Guard against /0 — empty window means zero averages.
  const avgAporteCents = monthsCount > 0 ? rollAporteCents / monthsCount : 0;
  const avgNetCents = monthsCount > 0 ? rollNetCents / monthsCount : 0;

  return {
    as_of_date: asOfDate,
    total_records: totalRecords,
    ytd: {
      year,
      aporte_brl: round2(ytdAporteCents / 100),
      resgate_brl: round2(ytdResgateCents / 100),
      net_brl: round2(ytdNetCents / 100),
    },
    rolling_12m: {
      from_month: fromMonth,
      to_month: toMonth,
      months_with_data: monthsCount,
      aporte_brl: round2(rollAporteCents / 100),
      resgate_brl: round2(rollResgateCents / 100),
      net_brl: round2(rollNetCents / 100),
      monthly_avg_aporte_brl: round2(avgAporteCents / 100),
      monthly_avg_net_brl: round2(avgNetCents / 100),
    },
  };
}
