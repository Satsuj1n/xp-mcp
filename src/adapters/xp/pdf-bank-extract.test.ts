import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveAmbiguousYear,
  isInvestmentTransfer,
  parseLine,
  extractAccountMetadata,
  parseBankExtractPdf,
  parseBankExtractText,
} from "./pdf-bank-extract.js";

test("resolveAmbiguousYear: maps low 2-digit years to 20XX", () => {
  assert.equal(resolveAmbiguousYear(26, 2026), 2026);
  assert.equal(resolveAmbiguousYear(0, 2026), 2000);
  assert.equal(resolveAmbiguousYear(31, 2026), 2031);
});

test("resolveAmbiguousYear: maps high 2-digit years to 19XX", () => {
  assert.equal(resolveAmbiguousYear(85, 2026), 1985);
  assert.equal(resolveAmbiguousYear(50, 2026), 1950);
});

test("resolveAmbiguousYear: edge at +5 boundary", () => {
  assert.equal(resolveAmbiguousYear(31, 2026), 2031);
  assert.equal(resolveAmbiguousYear(32, 2026), 1932);
});

test("isInvestmentTransfer: detects APORTE", () => {
  assert.equal(
    isInvestmentTransfer("Transferência enviada para conta investimento"),
    "APORTE",
  );
  assert.equal(
    isInvestmentTransfer("Transferência enviada para a conta investimento"),
    "APORTE",
  );
  assert.equal(
    isInvestmentTransfer("TRANSFERÊNCIA ENVIADA PARA CONTA INVESTIMENTO"),
    "APORTE",
  );
});

test("isInvestmentTransfer: detects RESGATE", () => {
  assert.equal(
    isInvestmentTransfer("Transferência recebida da conta investimento"),
    "RESGATE",
  );
  assert.equal(
    isInvestmentTransfer("Transferência recebida de conta investimento"),
    "RESGATE",
  );
  assert.equal(
    isInvestmentTransfer("Transferência recebida da a conta investimento"),
    "RESGATE",
  );
});

test("isInvestmentTransfer: returns null for non-transfers", () => {
  assert.equal(isInvestmentTransfer("Pix recebido de Bernardo"), null);
  assert.equal(isInvestmentTransfer("PAGAMENTO DE FATURA"), null);
  assert.equal(isInvestmentTransfer("TED recebida de FELIPE"), null);
  assert.equal(isInvestmentTransfer(""), null);
});

test("parseLine: extracts APORTE from a real-shape line", () => {
  const line =
    "19/05/26 às 07:03:19Transferência enviada para conta investimento-R$ 5.500,00R$ 394,33";
  const parsed = parseLine(line, 2026);
  assert.ok(parsed, "expected a parsed cash flow");
  assert.equal(parsed.kind, "APORTE");
  assert.equal(parsed.flow_date, "2026-05-19");
  assert.equal(parsed.flow_datetime, "2026-05-19 07:03:19");
  assert.equal(parsed.amount_cents, 550000);
  assert.match(
    parsed.description,
    /Transferência enviada para conta investimento/i,
  );
});

test("parseLine: extracts RESGATE", () => {
  const line =
    "15/05/26 às 10:30:44Transferência recebida da conta investimentoR$ 25,90R$ 27,90";
  const parsed = parseLine(line, 2026);
  assert.ok(parsed);
  assert.equal(parsed.kind, "RESGATE");
  assert.equal(parsed.flow_datetime, "2026-05-15 10:30:44");
  assert.equal(parsed.amount_cents, 2590);
});

test("parseLine: returns null for non-investment-transfer rows", () => {
  const line =
    "21/05/26 às 09:34:47Pix recebido de Bernardo Lopes DavidR$ 170,00R$ 717,14";
  assert.equal(parseLine(line, 2026), null);
});

test("parseLine: returns null for lines that don't match the line shape at all", () => {
  assert.equal(parseLine("Conta Digital Extrato", 2026), null);
  assert.equal(parseLine("", 2026), null);
  assert.equal(parseLine("DataDescriçãoValorSaldo", 2026), null);
});

test("parseLine: handles thousand separators in BRL amounts", () => {
  const line =
    "28/04/26 às 11:16:08Transferência enviada para a conta investimento-R$ 1.624,02R$ 1.000,00";
  const parsed = parseLine(line, 2026);
  assert.ok(parsed);
  assert.equal(parsed.amount_cents, 162402);
});

const SAMPLE_HEADER = `
22/05/2026 12:46:05Conta Digital XP | Extrato
Conta Digital Extrato
Data da consulta: 22/05/2026 12:46:05
FELIPE TESTBanco XP S.A | Agência: 0001 | Conta: 16751847
Documento: 000.000.000-00De: 23/11/2025 Até: 22/05/2026
`;

test("extractAccountMetadata: parses all four fields from a real header", () => {
  const meta = extractAccountMetadata(SAMPLE_HEADER);
  assert.equal(meta.account_holder, "FELIPE TEST");
  assert.equal(meta.account_number, "16751847");
  assert.equal(meta.period_from, "2025-11-23");
  assert.equal(meta.period_to, "2026-05-22");
});

test("extractAccountMetadata: returns nulls when header is missing", () => {
  const meta = extractAccountMetadata("just some unrelated text");
  assert.equal(meta.account_holder, null);
  assert.equal(meta.account_number, null);
  assert.equal(meta.period_from, null);
  assert.equal(meta.period_to, null);
});

test("extractAccountMetadata: handles partial header gracefully", () => {
  const meta = extractAccountMetadata(
    "De: 01/01/2026 Até: 31/01/2026\n(no account holder line)",
  );
  assert.equal(meta.period_from, "2026-01-01");
  assert.equal(meta.period_to, "2026-01-31");
  assert.equal(meta.account_holder, null);
  assert.equal(meta.account_number, null);
});

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TXT = join(
  HERE,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "extrato-bank-sample-anon.txt",
);
const FIXTURE_PDF = join(
  HERE,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "extrato-bank-sample.pdf",
);

test("parseBankExtractText: extracts 6 cash flows from the anon fixture", () => {
  const text = readFileSync(FIXTURE_TXT, "utf8");
  const result = parseBankExtractText(text, 2026);
  assert.equal(result.cash_flows.length, 6);
  assert.equal(result.ignored_lines, 3);
  assert.equal(result.warnings.length, 0);
});

test("parseBankExtractText: aportes and resgates are correctly classified", () => {
  const text = readFileSync(FIXTURE_TXT, "utf8");
  const result = parseBankExtractText(text, 2026);
  const aportes = result.cash_flows.filter((f) => f.kind === "APORTE");
  const resgates = result.cash_flows.filter((f) => f.kind === "RESGATE");
  assert.equal(aportes.length, 3);
  assert.equal(resgates.length, 3);
});

test("parseBankExtractText: extracts metadata", () => {
  const text = readFileSync(FIXTURE_TXT, "utf8");
  const result = parseBankExtractText(text, 2026);
  assert.equal(result.metadata.account_holder, "FELIPE TEST");
  assert.equal(result.metadata.account_number, "00000000");
  assert.equal(result.metadata.period_from, "2025-11-23");
  assert.equal(result.metadata.period_to, "2026-05-22");
});

test("parseBankExtractText: emits no-header warning when text has no extract markers", () => {
  const result = parseBankExtractText("just some random words here", 2026);
  assert.equal(result.cash_flows.length, 0);
  assert.ok(
    result.warnings.some((w) => /No bank extract header found/i.test(w)),
  );
});

test("parseBankExtractText: ignored_lines counts correctly", () => {
  const text = readFileSync(FIXTURE_TXT, "utf8");
  const result = parseBankExtractText(text, 2026);
  assert.equal(result.total_lines, 9);
  assert.equal(result.ignored_lines, 3);
});

test(
  "parseBankExtractPdf: full pipeline against real PDF (local only)",
  { skip: !existsSync(FIXTURE_PDF) },
  async () => {
    const result = await parseBankExtractPdf(FIXTURE_PDF);
    assert.ok(
      result.cash_flows.length > 0,
      "expected at least one cash flow from real PDF",
    );
    for (const row of result.cash_flows) {
      assert.ok(row.kind === "APORTE" || row.kind === "RESGATE");
      assert.ok(row.amount_cents > 0);
    }
  },
);
