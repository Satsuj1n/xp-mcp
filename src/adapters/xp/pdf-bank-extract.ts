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
 * Resolves a 2-digit year against an anchor reference year.
 *
 * For reference years up to ~2094 (the common case): if `yy <= (referenceYear % 100) + 5`,
 * map to `20YY`; otherwise map to `19YY`. Designed to sustain reliable parsing through ~2050.
 *
 * Beyond 2094, `(refMod + 5)` overflows past 99. The fallback branch uses a wrap-around
 * window: `yy` is treated as `20YY` when it falls inside the rolling threshold OR when it
 * is already greater than `refMod` (e.g. for refYear 2096, yy=97 → 2097, yy=01 → 2001).
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

import { parseBRLToCents } from "../../parsers/normalize.js";

/**
 * Matches one transaction row: date + "às" + time + description + signed amount + balance.
 * The greedy-min (.+?) for description works because the first BRL value (signed)
 * terminates the description; balance follows immediately.
 */
const LINE_RE =
  /^(\d{2})\/(\d{2})\/(\d{2}) às (\d{2}:\d{2}:\d{2})(.+?)(-?R\$ [\d.,]+)(R\$ [\d.,]+)$/;

/**
 * Parses one PDF line. Returns null when:
 *   - the line shape does not match LINE_RE (header, footer, blank, noise)
 *   - the description is not an investment-account transfer (Pix, TED, fatura)
 *   - the amount cannot be parsed to cents
 *
 * `referenceYear` is forwarded to `resolveAmbiguousYear` so the function stays
 * deterministic under test.
 */
export function parseLine(
  line: string,
  referenceYear: number = new Date().getFullYear(),
): ParsedCashFlow | null {
  const m = line.match(LINE_RE);
  if (!m) return null;

  const [, dd, mm, yy, hms, descriptionRaw, signedAmount] =
    m as RegExpMatchArray &
      [string, string, string, string, string, string, string, string];
  const description = descriptionRaw.trim();
  const kind = isInvestmentTransfer(description);
  if (kind == null) return null;

  const amount = parseBRLToCents(signedAmount);
  if (amount == null) return null;

  const yyyy = resolveAmbiguousYear(Number(yy), referenceYear);
  const flow_date = `${yyyy}-${mm}-${dd}`;
  const flow_datetime = `${flow_date} ${hms}`;

  return {
    flow_datetime,
    flow_date,
    kind,
    amount_cents: Math.abs(amount),
    description,
  };
}
