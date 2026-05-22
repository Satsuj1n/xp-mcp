/**
 * Parser for XP's Conta Digital Extrato PDF (digital current-account statement).
 * Filters for transfers between the digital account and the investment account
 * — those are the APORTE / RESGATE signals we want. Everything else (Pix, TED,
 * bill payments) is intentionally ignored.
 */

import { readFileSync } from "node:fs";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { parseBRLToCents, parseDateBR } from "../../parsers/normalize.js";

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

export interface ParsedBankExtractMetadata {
  account_holder: string | null;
  account_number: string | null;
  period_from: string | null;
  period_to: string | null;
}

const PERIOD_RE = /De:\s*(\d{2}\/\d{2}\/\d{4})\s*Até:\s*(\d{2}\/\d{2}\/\d{4})/i;
const ACCOUNT_RE = /^(.+?)Banco\s+XP\s+S\.?A/im;
const ACCOUNT_NUMBER_RE = /Conta:\s*(\d+)/i;

/**
 * Extracts header metadata. Each field is independent: failure to parse one
 * field does not impact the others. Missing fields return `null`.
 */
export function extractAccountMetadata(
  text: string,
): ParsedBankExtractMetadata {
  const period = text.match(PERIOD_RE);
  const account = text.match(ACCOUNT_RE);
  const accountNumber = text.match(ACCOUNT_NUMBER_RE);

  return {
    account_holder: account ? (account[1] ?? "").trim() || null : null,
    account_number: accountNumber ? (accountNumber[1] ?? null) : null,
    period_from: period ? (parseDateBR(period[1]) ?? null) : null,
    period_to: period ? (parseDateBR(period[2]) ?? null) : null,
  };
}

export interface ParsedBankExtract {
  cash_flows: ParsedCashFlow[];
  total_lines: number;
  ignored_lines: number;
  metadata: ParsedBankExtractMetadata;
  warnings: string[];
}

const HEADER_MARKER = /(Conta Digital Extrato|DataDescri[çc][aã]oValorSaldo)/i;

/**
 * Parses the full text content of a Conta Digital Extrato PDF. Pure function:
 * given the same text and reference year, always returns the same result.
 */
export function parseBankExtractText(
  text: string,
  referenceYear: number = new Date().getFullYear(),
): ParsedBankExtract {
  const warnings: string[] = [];
  const metadata = extractAccountMetadata(text);

  if (!HEADER_MARKER.test(text)) {
    warnings.push("No bank extract header found — is this the right PDF?");
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const cash_flows: ParsedCashFlow[] = [];
  let total_lines = 0;
  let ignored_lines = 0;

  for (const line of lines) {
    // Pre-check: only count lines that match the row shape.
    if (!LINE_RE.test(line)) continue;
    total_lines++;

    const parsed = parseLine(line, referenceYear);
    if (parsed == null) {
      ignored_lines++;
      continue;
    }
    cash_flows.push(parsed);
  }

  if (metadata.period_from == null || metadata.period_to == null) {
    warnings.push("Period metadata missing");
  }
  if (metadata.account_holder == null || metadata.account_number == null) {
    warnings.push("Account metadata missing");
  }

  return { cash_flows, total_lines, ignored_lines, metadata, warnings };
}

/**
 * Reads the PDF, extracts text via `pdf-parse`, delegates to
 * `parseBankExtractText`. The async boundary lives only at the I/O step;
 * downstream code is pure.
 */
export async function parseBankExtractPdf(
  filePath: string,
): Promise<ParsedBankExtract> {
  const buf = readFileSync(filePath);
  const data = await pdf(buf);
  return parseBankExtractText(data.text);
}
