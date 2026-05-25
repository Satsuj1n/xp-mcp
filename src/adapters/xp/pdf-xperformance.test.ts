import { test } from "node:test";
import assert from "node:assert/strict";
import { __internal } from "./pdf-xperformance.js";

const {
  parseAssetLine,
  pickClosestPctToken,
  parseXPerformanceText,
  XP_STRATEGIES,
  PT_BR_MONTH,
} = __internal;

// Anchors chosen so the expected %Aloc (market_value / patrimonio * 100)
// lands on the split documented in the parser's own docstring examples.
const PATRIMONIO_MXRF = 1_011_097; // makes MXRF11 expect ≈ 14.77%
const PATRIMONIO_BBAS = 864_220; // makes BBAS3 expect ≈ 27.63%

// ── pickClosestPctToken ───────────────────────────────────────────────────

test("pickClosestPctToken: resolves the qty/pct split closest to expected (MXRF case)", () => {
  // "1514,77%..." is ambiguous: qty=151/pct=4,77 | qty=15/pct=14,77 | qty=1/pct=514,77
  const pick = pickClosestPctToken("1514,77%0,71%190,39%9,12%184,93%--", 14.77);
  assert.ok(pick);
  assert.equal(pick.before, "15");
  assert.equal(pick.value, 14.77);
});

test("pickClosestPctToken: handles negative-decorated trailing tokens (BBAS case)", () => {
  const pick = pickClosestPctToken(
    "1127,63%-4,01%-1.070,30%-2,24%-45,47%--",
    27.63,
  );
  assert.ok(pick);
  assert.equal(pick.before, "11");
  assert.equal(pick.value, 27.63);
});

test("pickClosestPctToken: returns null when best drift exceeds 0.5", () => {
  // expected 99% is nowhere near any candidate token → no confident split
  assert.equal(pickClosestPctToken("1514,77%0,71%", 99.0), null);
});

test("pickClosestPctToken: returns null when there is no '%N,NN%' token at all", () => {
  assert.equal(pickClosestPctToken("no percent tokens here", 10), null);
});

// ── parseAssetLine: anchored qty/pct split ────────────────────────────────

test("parseAssetLine: FII line (MXRF11) with anchor → FII, qty 15, derived unit price", () => {
  const parsed = parseAssetLine(
    "MXRF11R$ 1.493,391514,77%0,71%190,39%9,12%184,93%--",
    "Fundos Listados",
    PATRIMONIO_MXRF,
  );
  assert.ok(parsed);
  assert.equal(parsed.asset_class, "FII");
  assert.equal(parsed.external_id, "MXRF11");
  assert.equal(parsed.name, "MXRF11");
  assert.equal(parsed.market_value_cents, 149339);
  assert.equal(parsed.quantity, 15);
  assert.equal(parsed.pct_allocation, 14.77);
  // unit price = round(149339 / 15)
  assert.equal(parsed.current_price_cents, 9956);
  assert.equal(parsed.strategy, "Fundos Listados");
});

test("parseAssetLine: ACAO line (BBAS3) with anchor → ACAO, qty 11", () => {
  const parsed = parseAssetLine(
    "BBAS3R$ 2.387,841127,63%-4,01%-1.070,30%-2,24%-45,47%--",
    "Renda Variável Brasil",
    PATRIMONIO_BBAS,
  );
  assert.ok(parsed);
  assert.equal(parsed.asset_class, "ACAO");
  assert.equal(parsed.external_id, "BBAS3");
  assert.equal(parsed.market_value_cents, 238784);
  assert.equal(parsed.quantity, 11);
  assert.equal(parsed.pct_allocation, 27.63);
  assert.equal(parsed.current_price_cents, 21708); // round(238784 / 11)
});

// ── parseAssetLine: fixed income (no anchor needed) ───────────────────────

test("parseAssetLine: CDB line extracts metadata; qty/price stay null", () => {
  const parsed = parseAssetLine(
    "CDB BANCO XP S.A. - NOV/2027 - 100,00% CDIR$ 1.069,1713,41%0,37%100,00%4,93%100,00%--",
    "Pós Fixado",
    null,
  );
  assert.ok(parsed);
  assert.equal(parsed.asset_class, "RENDA_FIXA_PRIVADA");
  assert.equal(
    parsed.external_id,
    "CDB BANCO XP S.A. - NOV/2027 - 100,00% CDI",
  );
  assert.equal(parsed.market_value_cents, 106917);
  assert.equal(parsed.issuer, "BANCO XP S.A.");
  assert.equal(parsed.indexer, "CDI");
  assert.equal(parsed.rate, "100,00% CDI");
  assert.equal(parsed.maturity_date, "2027-11-15");
  // No unit price for non-share assets
  assert.equal(parsed.current_price_cents, null);
  // No-anchor fallback: first "N,NN%" → pct=13.41, qty before is empty → null
  assert.equal(parsed.quantity, null);
  assert.equal(parsed.pct_allocation, 13.41);
});

test("parseAssetLine: Tesouro line extracts class + metadata", () => {
  const parsed = parseAssetLine(
    "Tesouro Selic 2031R$ 14.548,840,7746,47%0,38%101,31%1,65%94,82%--",
    "Pós Fixado",
    null,
  );
  assert.ok(parsed);
  assert.equal(parsed.asset_class, "TESOURO");
  assert.equal(parsed.external_id, "TESOURO SELIC 2031");
  assert.equal(parsed.name, "Tesouro Selic 2031");
  assert.equal(parsed.market_value_cents, 1454884);
  assert.equal(parsed.issuer, "Tesouro Nacional");
  assert.equal(parsed.indexer, "SELIC");
  assert.equal(parsed.maturity_date, "2031-12-31");
  // CHARACTERIZATION: the no-anchor fallback regex [\d.\s]*? cannot span the
  // comma inside "0,77", so it fails to match → both qty and pct stay null.
  assert.equal(parsed.quantity, null);
  assert.equal(parsed.pct_allocation, null);
});

// ── parseAssetLine: anchored fractional Tesouro (the REAL flow) ───────────

test("parseAssetLine: fractional Tesouro WITH anchor → qty 0.77, pct 46.47", () => {
  // This documents that the production flow (which always has a patrimônio
  // anchor) extracts the fractional quantity correctly. The null-qty case only
  // happens in the rare no-anchor fallback, where the split is ambiguous.
  const anchor = Math.round((1454884 * 100) / 46.47);
  const parsed = parseAssetLine(
    "Tesouro Selic 2031R$ 14.548,840,7746,47%0,38%101,31%1,65%94,82%--",
    "Pós Fixado",
    anchor,
  );
  assert.ok(parsed);
  assert.equal(parsed.asset_class, "TESOURO");
  assert.equal(parsed.market_value_cents, 1454884);
  assert.equal(parsed.quantity, 0.77);
  assert.equal(parsed.pct_allocation, 46.47);
});

// ── parseXPerformanceText: end-to-end text parsing ────────────────────────

// Patrimônio chosen so the Tesouro row's expected %Aloc lands on 46,47%:
// round(1.454.884 * 100 / 46.47) = 3.130.803 cents → "R$ 31.308,03".
const TESOURO_BLOCK = [
  "POSIÇÃO DETALHADA DOS ATIVOS",
  "Pós Fixado",
  "Tesouro Selic 2031R$ 14.548,840,7746,47%0,38%101,31%1,65%94,82%--",
  "MOVIMENTAÇÕES",
].join("\n");

test("parseXPerformanceText: WITH patrimônio anchor → correct qty/pct, no 'not extracted' warning", () => {
  const text = `Data de Referência: 30/04/2026
PATRIMÔNIO TOTAL BRUTO: R$ 31.308,03
${TESOURO_BLOCK}`;

  const result = parseXPerformanceText(text);

  assert.equal(result.patrimonio_total_cents, 3130803);
  assert.equal(result.reference_date, "2026-04-30");
  assert.equal(result.positions.length, 1);

  const tesouro = result.positions[0];
  assert.ok(tesouro);
  assert.equal(tesouro.asset_class, "TESOURO");
  assert.equal(tesouro.quantity, 0.77);
  assert.equal(tesouro.pct_allocation, 46.47);

  const notExtracted = result.warnings.filter((w) =>
    w.includes("not extracted"),
  );
  assert.deepEqual(notExtracted, []);
});

test("parseXPerformanceText: WITHOUT patrimônio anchor → null qty/pct AND 'not extracted' warning", () => {
  // Same block, but no PATRIMÔNIO line → no anchor → ambiguous split → null/null.
  const text = `Data de Referência: 30/04/2026
${TESOURO_BLOCK}`;

  const result = parseXPerformanceText(text);

  assert.equal(result.patrimonio_total_cents, null);
  assert.equal(result.positions.length, 1);

  const tesouro = result.positions[0];
  assert.ok(tesouro);
  assert.equal(tesouro.asset_class, "TESOURO");
  assert.equal(tesouro.quantity, null);
  assert.equal(tesouro.pct_allocation, null);

  const notExtracted = result.warnings.filter((w) =>
    w.includes("not extracted"),
  );
  assert.equal(notExtracted.length, 1);
  assert.ok(notExtracted[0]?.includes("Tesouro Selic 2031"));
});

// ── parseAssetLine: rejection paths ───────────────────────────────────────

test("parseAssetLine: returns null when the line has no 'R$ amount'", () => {
  assert.equal(parseAssetLine("Just some header text", "Caixa", null), null);
});

test("parseAssetLine: returns null when nothing precedes the money (empty name)", () => {
  assert.equal(parseAssetLine("R$ 1.000,00 10,00%", "Caixa", null), null);
});

test("parseAssetLine: returns null when the asset cannot be classified", () => {
  // Unknown name, strategy 'Caixa' is not a classification signal → null class
  assert.equal(
    parseAssetLine("Mystery Asset XYZR$ 500,0010,00%--", "Caixa", null),
    null,
  );
});

// ── exposed constants ─────────────────────────────────────────────────────

test("__internal: XP_STRATEGIES contains the canonical buckets", () => {
  assert.ok(XP_STRATEGIES.includes("Renda Variável Brasil"));
  assert.ok(XP_STRATEGIES.includes("Pós Fixado"));
  assert.ok(XP_STRATEGIES.includes("Fundos Listados"));
});

test("__internal: PT_BR_MONTH maps PT-BR month abbreviations to numbers", () => {
  assert.equal(PT_BR_MONTH.JAN, "01");
  assert.equal(PT_BR_MONTH.NOV, "11");
  assert.equal(PT_BR_MONTH.DEZ, "12");
});
