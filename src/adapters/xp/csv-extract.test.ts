import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExtractCsv } from "./csv-extract.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CSV = join(
  HERE,
  "..",
  "..",
  "..",
  "tests",
  "fixtures",
  "extract-xp-sample-anon.csv",
);

test("parseExtractCsv: parses all 4 rows into positions with no warnings", () => {
  const result = parseExtractCsv(FIXTURE_CSV);
  assert.equal(result.total_rows, 4);
  assert.equal(result.positions.length, 4);
  assert.equal(result.unrecognized_rows, 0);
  assert.equal(result.warnings.length, 0);
});

test("parseExtractCsv: classifies each asset class correctly", () => {
  const result = parseExtractCsv(FIXTURE_CSV);
  const byId = new Map(result.positions.map((p) => [p.external_id, p]));

  assert.equal(byId.get("BBAS3")?.asset_class, "ACAO");
  assert.equal(byId.get("MXRF11")?.asset_class, "FII");
  assert.equal(byId.get("TESOURO SELIC 2031")?.asset_class, "TESOURO");
  assert.equal(
    byId.get("CDB BANCO XP S.A. - NOV/2027 - 100,00% CDI")?.asset_class,
    "RENDA_FIXA_PRIVADA",
  );
});

test("parseExtractCsv: parses the ACAO row's numeric fields", () => {
  const result = parseExtractCsv(FIXTURE_CSV);
  const bbas3 = result.positions.find((p) => p.external_id === "BBAS3");
  assert.ok(bbas3);
  assert.equal(bbas3.name, "Banco do Brasil ON");
  assert.equal(bbas3.quantity, 100);
  assert.equal(bbas3.avg_price_cents, 2500);
  assert.equal(bbas3.current_price_cents, 2763);
  assert.equal(bbas3.invested_cents, 250000);
  assert.equal(bbas3.market_value_cents, 276300);
  assert.equal(bbas3.has_fgc, null); // ACAO → null
});

test("parseExtractCsv: parses fractional quantity on the Tesouro row", () => {
  const result = parseExtractCsv(FIXTURE_CSV);
  const tesouro = result.positions.find(
    (p) => p.external_id === "TESOURO SELIC 2031",
  );
  assert.ok(tesouro);
  assert.equal(tesouro.quantity, 0.77);
  assert.equal(tesouro.market_value_cents, 1120260);
  assert.equal(tesouro.issuer, "Tesouro Nacional");
  assert.equal(tesouro.indexer, "SELIC");
  assert.equal(tesouro.maturity_date, "2031-12-31");
  assert.equal(tesouro.has_fgc, false); // TESOURO → false (sovereign)
});

test("parseExtractCsv: CDB row carries issuer/indexer/rate/maturity and FGC=true", () => {
  const result = parseExtractCsv(FIXTURE_CSV);
  const cdb = result.positions.find(
    (p) => p.external_id === "CDB BANCO XP S.A. - NOV/2027 - 100,00% CDI",
  );
  assert.ok(cdb);
  assert.equal(cdb.issuer, "BANCO XP S.A.");
  assert.equal(cdb.indexer, "CDI");
  assert.equal(cdb.rate, "100,00% CDI");
  assert.equal(cdb.maturity_date, "2027-11-15");
  assert.equal(cdb.market_value_cents, 106917);
  assert.equal(cdb.has_fgc, true); // RENDA_FIXA_PRIVADA → true
  // CDB has no ticker / quantity columns populated
  assert.equal(cdb.quantity, null);
});

test("parseExtractCsv: external_id is uppercased for ticker rows", () => {
  const result = parseExtractCsv(FIXTURE_CSV);
  const ids = result.positions.map((p) => p.external_id);
  assert.ok(ids.includes("BBAS3"));
  assert.ok(ids.includes("MXRF11"));
});
