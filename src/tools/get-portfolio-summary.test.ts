import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import {
  createImportRecord,
  upsertPositions,
} from "../storage/positions-repo.js";
import { getPortfolioSummary } from "./get-portfolio-summary.js";

function withSeededDb(seed: (db: Database.Database) => void): {
  db: Database.Database;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-summary-tool-"));
  const db = new Database(join(dir, "data.db"));
  applySchema(db);
  seed(db);
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("get_portfolio_summary handler: happy path", async () => {
  const { db, cleanup } = withSeededDb((db) => {
    const importId = createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x.pdf",
      totalRows: 2,
      declaredTotalCents: 2000000,
      referenceDate: "2026-05-21",
    });
    upsertPositions(
      db,
      [
        {
          asset_class: "FII",
          external_id: "MXRF11",
          name: "MXRF11",
          quantity: 100,
          avg_price_cents: null,
          current_price_cents: null,
          invested_cents: 900000,
          market_value_cents: 1000000,
          issuer: null,
          indexer: null,
          rate: null,
          maturity_date: null,
          has_fgc: null,
        },
        {
          asset_class: "TESOURO",
          external_id: "TESOURO_SELIC_2031",
          name: "Tesouro Selic 2031",
          quantity: 1,
          avg_price_cents: null,
          current_price_cents: null,
          invested_cents: null,
          market_value_cents: 1000000,
          issuer: null,
          indexer: null,
          rate: null,
          maturity_date: "2031-01-01",
          has_fgc: 0,
        },
      ],
      importId,
    );
  });
  try {
    const out = await getPortfolioSummary({}, { db });
    assert.equal(out.total_market_value_brl, 20000);
    assert.equal(out.positions_count, 2);
    assert.equal(out.by_class.length, 2);
    assert.ok(out.reconciliation);
    assert.equal(out.reconciliation!.gap_brl, 0);
  } finally {
    cleanup();
  }
});

test("get_portfolio_summary handler: empty DB", async () => {
  const { db, cleanup } = withSeededDb(() => {});
  try {
    const out = await getPortfolioSummary({}, { db });
    assert.equal(out.total_market_value_brl, 0);
    assert.equal(out.positions_count, 0);
    assert.equal(out.reconciliation, null);
    assert.ok(out.warnings.length > 0);
  } finally {
    cleanup();
  }
});
