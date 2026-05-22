/**
 * Parser for XP's Conta Digital Extrato PDF (digital current-account statement).
 * Filters for transfers between the digital account and the investment account
 * — those are the APORTE / RESGATE signals we want. Everything else (Pix, TED,
 * bill payments) is intentionally ignored.
 */

export type CashFlowKind = "APORTE" | "RESGATE";

export interface ParsedCashFlow {
  flow_datetime: string;
  flow_date: string;
  kind: CashFlowKind;
  amount_cents: number;
  description: string;
}

const APORTE_RE =
  /transfer[êe]ncia\s+enviada\s+para\s+(?:a\s+)?conta\s+investimento/i;
const RESGATE_RE =
  /transfer[êe]ncia\s+recebida\s+(?:da|de)\s+(?:a\s+)?conta\s+investimento/i;

/**
 * Classifies a description string as APORTE / RESGATE or null when it is not
 * an investment-account transfer.
 *
 * Both regexes are case-insensitive, tolerate optional articles ("a" / "da" /
 * "de"), and accept accent variations on the source.
 */
export function isInvestmentTransfer(description: string): CashFlowKind | null {
  if (APORTE_RE.test(description)) return "APORTE";
  if (RESGATE_RE.test(description)) return "RESGATE";
  return null;
}

/**
 * Resolves a 2-digit year against an anchor reference year using the rule:
 *   YY <= (referenceYear % 100) + 5  →  20YY
 *   otherwise                        →  19YY
 *
 * Designed to sustain reliable parsing through roughly 2050.
 */
export function resolveAmbiguousYear(
  yy: number,
  referenceYear: number = new Date().getFullYear(),
): number {
  const refMod = referenceYear % 100;
  const threshold = (refMod + 5) % 100;
  if (refMod + 5 < 100) {
    return yy <= threshold ? 2000 + yy : 1900 + yy;
  }
  return yy <= threshold || yy > refMod ? 2000 + yy : 1900 + yy;
}
