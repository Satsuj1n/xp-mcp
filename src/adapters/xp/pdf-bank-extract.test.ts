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
