import type { AssetClass } from "../storage/schema.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AllocationTarget } from "../parsers/allocation-target.js";
import { round2 } from "./money.js";

export interface DriftRow {
  asset_class: AssetClass;
  current_brl: number;
  current_pct: number;
  target_pct: number;
  target_brl: number;
  drift_pp: number; // signed: positive = overweight
  status: "ok" | "overweight" | "underweight";
  action: { side: "BUY" | "SELL"; amount_brl: number } | null;
}

export interface DriftReport {
  total_brl: number;
  tolerance_pp: number | null;
  target_path: string;
  reference_date: string | null;
  drift: DriftRow[];
  rebalance_net_brl: number;
  warnings: string[];
}

/**
 * Pure function: given positions and a target, compute the drift report.
 * Never touches the filesystem, the database, or the network.
 */
export function computeDrift(
  positions: PositionRow[],
  target: AllocationTarget,
): DriftReport {
  // tolerance_pp absent ⇒ treat as 0 (unifying defaults)
  const tolerance = target.tolerance_pp ?? 0;
  const warnings: string[] = [];

  // 1) Aggregate market values by asset_class, in cents.
  const byClassCents = new Map<AssetClass, number>();
  let skipped = 0;
  let latestImport: string | null = null;

  for (const p of positions) {
    if (p.market_value_cents == null) {
      skipped++;
      continue;
    }
    byClassCents.set(
      p.asset_class,
      (byClassCents.get(p.asset_class) ?? 0) + p.market_value_cents,
    );
    if (latestImport == null || p.last_imported_at > latestImport) {
      latestImport = p.last_imported_at;
    }
  }

  if (skipped > 0) {
    warnings.push(
      `${skipped} position${skipped === 1 ? "" : "s"} skipped (no market value)`,
    );
  }

  if (positions.length === 0) {
    warnings.push(
      "No positions in database. Run import_xperformance_pdf or import_extract_csv first.",
    );
  }

  const totalCents = Array.from(byClassCents.values()).reduce(
    (a, b) => a + b,
    0,
  );

  // Early exit: no positions with market value → drift is undefined (not all-underweight)
  if (byClassCents.size === 0) {
    return {
      total_brl: 0,
      tolerance_pp: target.tolerance_pp,
      target_path: target.source_path,
      reference_date: latestImport,
      drift: [],
      rebalance_net_brl: 0,
      warnings,
    };
  }

  // 2) Union of asset classes from positions ∪ target
  const targetKeys = Object.keys(target.target_allocation) as AssetClass[];
  const allClasses = new Set<AssetClass>([
    ...byClassCents.keys(),
    ...targetKeys,
  ]);

  // 3) Build one row per class (filter degenerate 0/0)
  const rows: DriftRow[] = [];
  for (const cls of allClasses) {
    const currentCents = byClassCents.get(cls) ?? 0;
    const targetPct = target.target_allocation[cls] ?? 0;

    if (currentCents === 0 && targetPct === 0) continue;

    const currentPct = totalCents > 0 ? currentCents / totalCents : 0;
    const targetCents = Math.round(targetPct * totalCents);
    const driftPpRaw = (currentPct - targetPct) * 100; // signed, full precision
    const deltaCents = currentCents - targetCents; // + → sell, − → buy

    let status: DriftRow["status"];
    let action: DriftRow["action"];

    if (Math.abs(driftPpRaw) <= tolerance) {
      status = "ok";
      action = null;
    } else if (driftPpRaw > 0) {
      status = "overweight";
      action = { side: "SELL", amount_brl: round2(deltaCents / 100) };
    } else {
      status = "underweight";
      action = { side: "BUY", amount_brl: round2(-deltaCents / 100) };
    }

    rows.push({
      asset_class: cls,
      current_brl: round2(currentCents / 100),
      current_pct: currentPct,
      target_pct: targetPct,
      target_brl: round2(targetCents / 100),
      drift_pp: round2(driftPpRaw),
      status,
      action,
    });
  }

  // 4) Sort by |drift_pp| descending — surface biggest problems first.
  rows.sort((a, b) => Math.abs(b.drift_pp) - Math.abs(a.drift_pp));

  // 5) Self-consistency: SELL total minus BUY total should be ≈ 0.
  let net = 0;
  for (const r of rows) {
    if (r.action?.side === "SELL") net += r.action.amount_brl;
    if (r.action?.side === "BUY") net -= r.action.amount_brl;
  }
  // net ≈ 0 is only expected when every drift drives an action. If any row is
  // "ok" (drift within tolerance), its imbalance is intentionally absorbed and
  // net legitimately diverges from zero. Only warn if no ok-state row could
  // account for the gap.
  const allRowsHaveAction = rows.every((r) => r.action !== null);
  if (allRowsHaveAction && Math.abs(net) > 0.02) {
    warnings.push(
      `rebalance_net_brl is ${net.toFixed(2)} (expected ≈ 0; math bug suspected)`,
    );
  }

  return {
    total_brl: round2(totalCents / 100),
    tolerance_pp: target.tolerance_pp,
    target_path: target.source_path,
    reference_date: latestImport,
    drift: rows,
    rebalance_net_brl: round2(net),
    warnings,
  };
}
