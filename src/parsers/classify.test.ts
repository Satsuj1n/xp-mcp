import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyAsset,
  parseNameMetadata,
  buildExternalId,
} from "./classify.js";

// ── classifyAsset: rule 1 — explicit raw_class (highest priority) ─────────

test("classifyAsset: raw_class containing 'imobil' wins → FII", () => {
  // Even though BBAS3 would shape-match ACAO, explicit class overrides.
  assert.equal(
    classifyAsset({ raw_class: "Fundo Imobiliário", ticker_or_name: "BBAS3" }),
    "FII",
  );
});

test("classifyAsset: raw_class containing 'etf' wins → ETF", () => {
  assert.equal(
    classifyAsset({ raw_class: "ETF", ticker_or_name: "MXRF11" }),
    "ETF",
  );
});

test("classifyAsset: raw_class 'Ação' / 'acao' / 'ações' / 'acoes' → ACAO", () => {
  assert.equal(
    classifyAsset({ raw_class: "Ação", ticker_or_name: "Foo" }),
    "ACAO",
  );
  assert.equal(
    classifyAsset({ raw_class: "acao", ticker_or_name: "Foo" }),
    "ACAO",
  );
  assert.equal(
    classifyAsset({ raw_class: "Ações", ticker_or_name: "Foo" }),
    "ACAO",
  );
  assert.equal(
    classifyAsset({ raw_class: "Acoes", ticker_or_name: "Foo" }),
    "ACAO",
  );
});

test("classifyAsset: raw_class containing 'tesouro' → TESOURO", () => {
  assert.equal(
    classifyAsset({ raw_class: "Tesouro Direto", ticker_or_name: "Foo" }),
    "TESOURO",
  );
});

test("classifyAsset: raw_class precedence — 'imobil' beats ticker shape AND tesouro name", () => {
  // name says TESOURO (rule 2) but raw_class imobil (rule 1) is checked first
  assert.equal(
    classifyAsset({
      raw_class: "Fundo Imobiliário",
      ticker_or_name: "Tesouro Selic 2031",
    }),
    "FII",
  );
});

// ── classifyAsset: rule 2 — Tesouro by name / issuer ──────────────────────

test("classifyAsset: name containing 'TESOURO' → TESOURO", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "Tesouro Selic 2031" }),
    "TESOURO",
  );
});

test("classifyAsset: issuer 'Tesouro Nacional' → TESOURO", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "LTN 2027", issuer: "Tesouro Nacional" }),
    "TESOURO",
  );
});

// ── classifyAsset: rule 3 — private fixed income ──────────────────────────

test("classifyAsset: CDB prefix → RENDA_FIXA_PRIVADA", () => {
  assert.equal(
    classifyAsset({
      ticker_or_name: "CDB BANCO XP S.A. - NOV/2027 - 100% CDI",
    }),
    "RENDA_FIXA_PRIVADA",
  );
});

test("classifyAsset: LCI / LCA prefixes → RENDA_FIXA_PRIVADA", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "LCI Banco Foo - 2026" }),
    "RENDA_FIXA_PRIVADA",
  );
  assert.equal(
    classifyAsset({ ticker_or_name: "LCA Banco Bar - 2027" }),
    "RENDA_FIXA_PRIVADA",
  );
});

test("classifyAsset: Debênture (accented and unaccented) → RENDA_FIXA_PRIVADA", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "Debênture Empresa XYZ 2030" }),
    "RENDA_FIXA_PRIVADA",
  );
  assert.equal(
    classifyAsset({ ticker_or_name: "DEBENTURE EMPRESA XYZ 2030" }),
    "RENDA_FIXA_PRIVADA",
  );
});

test("classifyAsset: CRA / CRI prefixes → RENDA_FIXA_PRIVADA", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "CRA Agro Foo 2031" }),
    "RENDA_FIXA_PRIVADA",
  );
  assert.equal(
    classifyAsset({ ticker_or_name: "CRI Imob Bar 2032" }),
    "RENDA_FIXA_PRIVADA",
  );
});

// ── classifyAsset: rule 4 — investment funds (NOT FII) ────────────────────

test("classifyAsset: FIF/FIC/FIM/FIA fund names → FUNDO", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "XP Referenciado FIF RF DI CP RL" }),
    "FUNDO",
  );
  assert.equal(
    classifyAsset({ ticker_or_name: "Trend Bolsa FIC Ações" }),
    "FUNDO",
  );
  assert.equal(classifyAsset({ ticker_or_name: "XP Macro FIM CP" }), "FUNDO");
  assert.equal(
    classifyAsset({ ticker_or_name: "Alaska Black FIA BDR Nível I" }),
    "FUNDO",
  );
});

test("classifyAsset: 'Multimercado' keyword → FUNDO", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "XP Multimercado Crédito" }),
    "FUNDO",
  );
});

test("classifyAsset: ' FUNDO ' word boundary → FUNDO", () => {
  // regex /\b FUNDO\b/ requires a literal space before FUNDO
  assert.equal(
    classifyAsset({ ticker_or_name: "Meu FUNDO de Crédito Privado" }),
    "FUNDO",
  );
});

test("classifyAsset: name STARTING with 'Fundo' (no sigla/keyword) → FUNDO", () => {
  // \b anchors the word boundary at the string start; no leading space required
  assert.equal(
    classifyAsset({ ticker_or_name: "Fundo de Crédito Privado XPTO" }),
    "FUNDO",
  );
});

test("classifyAsset: a ####11 ticker is FII, not FUNDO, even with fund-ish text nearby", () => {
  // looksLikeFII short-circuits the FUNDO branch
  assert.equal(classifyAsset({ ticker_or_name: "MXRF11" }), "FII");
});

// ── classifyAsset: rule 5 — listed asset ticker shapes ────────────────────

test("classifyAsset: ####3 and ####4 tickers → ACAO", () => {
  assert.equal(classifyAsset({ ticker_or_name: "BBAS3" }), "ACAO");
  assert.equal(classifyAsset({ ticker_or_name: "PETR4" }), "ACAO");
});

test("classifyAsset: ####5 and ####6 tickers → ACAO", () => {
  assert.equal(classifyAsset({ ticker_or_name: "TIET5" }), "ACAO");
  assert.equal(classifyAsset({ ticker_or_name: "ELET6" }), "ACAO");
});

test("classifyAsset: ####11 ticker → FII by default", () => {
  assert.equal(classifyAsset({ ticker_or_name: "MXRF11" }), "FII");
  assert.equal(classifyAsset({ ticker_or_name: "HGLG11" }), "FII");
});

test("classifyAsset: ####11 in KNOWN_ETF_TICKERS (BOVA11) → ETF", () => {
  assert.equal(classifyAsset({ ticker_or_name: "BOVA11" }), "ETF");
  assert.equal(classifyAsset({ ticker_or_name: "IVVB11" }), "ETF");
  // lowercase still resolves via uppercasing
  assert.equal(classifyAsset({ ticker_or_name: "bova11" }), "ETF");
});

// ── classifyAsset: rule 6 — strategy fallback (weak) ──────────────────────

test("classifyAsset: 'Renda Variável' strategy fallback → ACAO", () => {
  // name doesn't match any ticker shape; strategy decides
  assert.equal(
    classifyAsset({
      ticker_or_name: "Some Unknown Equity",
      strategy: "Renda Variável Brasil",
    }),
    "ACAO",
  );
  // unaccented variant also works
  assert.equal(
    classifyAsset({
      ticker_or_name: "Some Unknown Equity",
      strategy: "Renda Variavel Global",
    }),
    "ACAO",
  );
});

// ── classifyAsset: ambiguous → null ───────────────────────────────────────

test("classifyAsset: unrecognized name with no hints → null", () => {
  assert.equal(
    classifyAsset({ ticker_or_name: "Totally Unknown Thing" }),
    null,
  );
});

test("classifyAsset: empty name with no hints → null", () => {
  assert.equal(classifyAsset({ ticker_or_name: "" }), null);
});

test("classifyAsset: 3-letter ticker (not 4) does not match ACAO shape → null", () => {
  // regex requires exactly 4 letters before digits
  assert.equal(classifyAsset({ ticker_or_name: "AB3" }), null);
});

// ── parseNameMetadata: Tesouro ────────────────────────────────────────────

test("parseNameMetadata: 'Tesouro Selic 2031' extracts SELIC + year-end maturity", () => {
  const meta = parseNameMetadata("Tesouro Selic 2031");
  assert.equal(meta.issuer, "Tesouro Nacional");
  assert.equal(meta.indexer, "SELIC");
  assert.equal(meta.rate, null);
  assert.equal(meta.maturity_date, "2031-12-31");
});

test("parseNameMetadata: 'Tesouro IPCA+ 2035' extracts IPCA", () => {
  const meta = parseNameMetadata("Tesouro IPCA+ 2035");
  assert.equal(meta.issuer, "Tesouro Nacional");
  assert.equal(meta.indexer, "IPCA");
  assert.equal(meta.maturity_date, "2035-12-31");
});

test("parseNameMetadata: 'Tesouro Prefixado 2029' extracts PRE", () => {
  const meta = parseNameMetadata("Tesouro Prefixado 2029");
  assert.equal(meta.indexer, "PRE");
  assert.equal(meta.maturity_date, "2029-12-31");
});

test("parseNameMetadata: Tesouro without a 4-digit year → null maturity", () => {
  const meta = parseNameMetadata("Tesouro Selic");
  assert.equal(meta.issuer, "Tesouro Nacional");
  assert.equal(meta.indexer, "SELIC");
  assert.equal(meta.maturity_date, null);
});

// ── parseNameMetadata: CDB pattern "EMISSOR - MES/ANO - TAXA" ──────────────

test("parseNameMetadata: CDB with CDI rate extracts issuer/indexer/rate/maturity", () => {
  const meta = parseNameMetadata("CDB BANCO XP S.A. - NOV/2027 - 100,00% CDI");
  assert.equal(meta.issuer, "BANCO XP S.A.");
  assert.equal(meta.indexer, "CDI");
  assert.equal(meta.rate, "100,00% CDI");
  assert.equal(meta.maturity_date, "2027-11-15");
});

test("parseNameMetadata: CDB with prefixed rate (no CDI) → PRE indexer", () => {
  const meta = parseNameMetadata("CDB BANCO XP S.A. - AGO/2026 - 15,00%");
  assert.equal(meta.issuer, "BANCO XP S.A.");
  assert.equal(meta.indexer, "PRE");
  assert.equal(meta.rate, "15,00%");
  assert.equal(meta.maturity_date, "2026-08-15");
});

test("parseNameMetadata: LCI follows the same pattern", () => {
  const meta = parseNameMetadata("LCI BANCO FOO - JAN/2028 - 95,00% CDI");
  assert.equal(meta.issuer, "BANCO FOO");
  assert.equal(meta.indexer, "CDI");
  assert.equal(meta.maturity_date, "2028-01-15");
});

test("parseNameMetadata: no-match name returns all nulls", () => {
  const meta = parseNameMetadata("BBAS3");
  assert.deepEqual(meta, {
    issuer: null,
    indexer: null,
    rate: null,
    maturity_date: null,
  });
});

// ── buildExternalId ───────────────────────────────────────────────────────

test("buildExternalId: ACAO/FII/ETF extracts ticker prefix uppercased", () => {
  assert.equal(buildExternalId("ACAO", "bbas3"), "BBAS3");
  assert.equal(buildExternalId("FII", "MXRF11 - CI"), "MXRF11");
  assert.equal(buildExternalId("ETF", "BOVA11 ETF"), "BOVA11");
});

test("buildExternalId: listed asset with no ticker shape falls back to canonical name", () => {
  // no ^[A-Z]{4}\d{1,2} prefix → uses whole uppercased/collapsed name
  assert.equal(buildExternalId("ACAO", "Some Equity Name"), "SOME EQUITY NAME");
});

test("buildExternalId: non-listed classes always use canonical name", () => {
  assert.equal(
    buildExternalId("TESOURO", "Tesouro   Selic  2031"),
    "TESOURO SELIC 2031",
  );
  assert.equal(
    buildExternalId(
      "RENDA_FIXA_PRIVADA",
      "CDB BANCO XP S.A. - NOV/2027 - 100,00% CDI",
    ),
    "CDB BANCO XP S.A. - NOV/2027 - 100,00% CDI",
  );
});
