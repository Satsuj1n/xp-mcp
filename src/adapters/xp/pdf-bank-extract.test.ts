import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAmbiguousYear,
  isInvestmentTransfer,
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

import { parseLine } from "./pdf-bank-extract.js";

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
