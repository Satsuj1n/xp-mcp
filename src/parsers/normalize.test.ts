import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBRLToCents,
  parseQuantity,
  parseDateBR,
  normalizeHeader,
} from "./normalize.js";

// ── parseBRLToCents ──────────────────────────────────────────────────────

test("parseBRLToCents: parses 'R$ 1.234,56' to 123456 cents", () => {
  assert.equal(parseBRLToCents("R$ 1.234,56"), 123456);
});

test("parseBRLToCents: parses bare BR string '1.234,56' to 123456 cents", () => {
  assert.equal(parseBRLToCents("1.234,56"), 123456);
});

test("parseBRLToCents: parses dot-decimal '1234.56' to 123456 cents", () => {
  assert.equal(parseBRLToCents("1234.56"), 123456);
});

test("parseBRLToCents: parses comma-decimal '0,5' to 50 cents", () => {
  assert.equal(parseBRLToCents("0,5"), 50);
});

test("parseBRLToCents: handles plain integer '100' to 10000 cents", () => {
  assert.equal(parseBRLToCents("100"), 10000);
});

test("parseBRLToCents: both comma and dot — rightmost separator is decimal (BR)", () => {
  // comma is rightmost → decimal; dots are thousands
  assert.equal(parseBRLToCents("1.234.567,89"), 123456789);
});

test("parseBRLToCents: both comma and dot — dot rightmost means dot is decimal (US)", () => {
  // dot is rightmost → decimal; commas are thousands
  assert.equal(parseBRLToCents("1,234,567.89"), 123456789);
});

test("parseBRLToCents: lowercase 'r$' prefix and surrounding spaces", () => {
  assert.equal(parseBRLToCents("  r$ 42,00 "), 4200);
});

test("parseBRLToCents: empty string returns null", () => {
  assert.equal(parseBRLToCents(""), null);
});

test("parseBRLToCents: dash placeholder '-' returns null", () => {
  assert.equal(parseBRLToCents("-"), null);
});

test("parseBRLToCents: null and undefined return null", () => {
  assert.equal(parseBRLToCents(null), null);
  assert.equal(parseBRLToCents(undefined), null);
});

test("parseBRLToCents: rounds to nearest cent", () => {
  // 0,005 → 0.5 cents → rounds to 1 (banker-less Math.round)
  assert.equal(parseBRLToCents("0,005"), 1);
  // 1,234 → 123.4 cents → rounds to 123
  assert.equal(parseBRLToCents("1,234"), 123);
});

test("parseBRLToCents: negative value keeps sign", () => {
  assert.equal(parseBRLToCents("-R$ 5,00"), -500);
});

// ── parseQuantity ────────────────────────────────────────────────────────

test("parseQuantity: parses fractional '0,5' to 0.5 (not cents)", () => {
  assert.equal(parseQuantity("0,5"), 0.5);
});

test("parseQuantity: parses '1.234,56' to 1234.56", () => {
  assert.equal(parseQuantity("1.234,56"), 1234.56);
});

test("parseQuantity: parses dot-decimal '1234.56' to 1234.56", () => {
  assert.equal(parseQuantity("1234.56"), 1234.56);
});

test("parseQuantity: parses whole share count '15' to 15", () => {
  assert.equal(parseQuantity("15"), 15);
});

test("parseQuantity: empty / '-' / null / undefined return null", () => {
  assert.equal(parseQuantity(""), null);
  assert.equal(parseQuantity("-"), null);
  assert.equal(parseQuantity(null), null);
  assert.equal(parseQuantity(undefined), null);
});

test("parseQuantity: both comma and dot — rightmost comma is decimal", () => {
  assert.equal(parseQuantity("1.000,5"), 1000.5);
});

test("parseQuantity: both comma and dot — rightmost dot is decimal", () => {
  assert.equal(parseQuantity("1,000.5"), 1000.5);
});

// ── parseDateBR ──────────────────────────────────────────────────────────

test("parseDateBR: converts BR slash date '15/05/2035' to ISO", () => {
  assert.equal(parseDateBR("15/05/2035"), "2035-05-15");
});

test("parseDateBR: converts BR dash date '15-05-2035' to ISO", () => {
  assert.equal(parseDateBR("15-05-2035"), "2035-05-15");
});

test("parseDateBR: ISO date passes through unchanged", () => {
  assert.equal(parseDateBR("2035-05-15"), "2035-05-15");
});

test("parseDateBR: empty / null / undefined return null", () => {
  assert.equal(parseDateBR(""), null);
  assert.equal(parseDateBR(null), null);
  assert.equal(parseDateBR(undefined), null);
});

test("parseDateBR: unparseable / partial formats return null", () => {
  assert.equal(parseDateBR("not a date"), null);
  assert.equal(parseDateBR("15/05/35"), null); // 2-digit year not supported
  assert.equal(parseDateBR("2035/05/15"), null); // wrong ISO separator order
});

test("parseDateBR: trims surrounding whitespace before matching", () => {
  assert.equal(parseDateBR("  15/05/2035  "), "2035-05-15");
});

// ── normalizeHeader ──────────────────────────────────────────────────────

test("normalizeHeader: lowercases and strips accents", () => {
  assert.equal(normalizeHeader("Preço Médio"), "preco medio");
  assert.equal(normalizeHeader("Código de Negociação"), "codigo de negociacao");
});

test("normalizeHeader: collapses repeated whitespace to single space", () => {
  assert.equal(normalizeHeader("Valor   de    Mercado"), "valor de mercado");
});

test("normalizeHeader: trims leading/trailing whitespace", () => {
  assert.equal(normalizeHeader("  Quantidade  "), "quantidade");
});

test("normalizeHeader: handles already-normalized input idempotently", () => {
  assert.equal(normalizeHeader("ticker"), "ticker");
});
