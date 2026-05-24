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
import { insertCashFlows } from "../storage/cash-flows-repo.js";
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
    assert.equal(out.cash_flow_summary, null);
    assert.ok(out.warnings.length > 0);
  } finally {
    cleanup();
  }
});

test("get_portfolio_summary handler: positions but no cash flows → cash_flow_summary null + warning", async () => {
  const { db, cleanup } = withSeededDb((db) => {
    const importId = createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x.pdf",
      totalRows: 1,
      declaredTotalCents: 1000000,
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
      ],
      importId,
    );
  });
  try {
    const out = await getPortfolioSummary({}, { db });
    assert.equal(out.cash_flow_summary, null);
    assert.ok(
      out.warnings.some((w) =>
        w.includes("No cash flows imported yet; cash_flow_summary unavailable"),
      ),
      `expected warning, got: ${JSON.stringify(out.warnings)}`,
    );
  } finally {
    cleanup();
  }
});

test("get_portfolio_summary handler: cash flows inside rolling window populate cash_flow_summary", async () => {
  const now = new Date("2026-05-24T12:00:00Z");
  const { db, cleanup } = withSeededDb((db) => {
    const positionsImportId = createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/x.pdf",
      totalRows: 1,
      declaredTotalCents: 1000000,
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
      ],
      positionsImportId,
    );
    const cashImportId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/extract.pdf",
      totalRows: 1,
    });
    insertCashFlows(
      db,
      [
        {
          flow_datetime: "2026-05-15 10:00:00",
          flow_date: "2026-05-15",
          kind: "APORTE",
          amount_cents: 100000, // R$ 1000
          description: "Aporte",
        },
      ],
      cashImportId,
    );
  });
  try {
    const out = await getPortfolioSummary({}, { db, now });
    assert.ok(out.cash_flow_summary, "expected cash_flow_summary populated");
    assert.equal(out.cash_flow_summary!.as_of_date, "2026-05-24");
    assert.equal(out.cash_flow_summary!.total_records, 1);
    assert.equal(out.cash_flow_summary!.ytd.aporte_brl, 1000);
    assert.equal(out.cash_flow_summary!.ytd.net_brl, 1000);
    assert.equal(out.cash_flow_summary!.rolling_12m.aporte_brl, 1000);
    assert.ok(
      !out.warnings.some((w) => w.includes("No cash flows imported yet")),
      `expected no cash-flow warning, got: ${JSON.stringify(out.warnings)}`,
    );
  } finally {
    cleanup();
  }
});

test("get_portfolio_summary handler: cash flow outside rolling window → cash_flow_summary null + warning", async () => {
  // Rolling window for as_of 2026-05-24 starts at 2025-06-01. A flow on
  // 2025-05-01 is one month BEFORE the window, so listCashFlowsSince
  // returns []. This pins the contract that the tool wrapper, not the
  // pure service, decides "no cash flows in window means null + warning."
  const now = new Date("2026-05-24T12:00:00Z");
  const { db, cleanup } = withSeededDb((db) => {
    const cashImportId = createImportRecord(db, {
      sourceType: "pdf_bank_extract",
      sourcePath: "/tmp/extract.pdf",
      totalRows: 1,
    });
    insertCashFlows(
      db,
      [
        {
          flow_datetime: "2025-05-01 10:00:00",
          flow_date: "2025-05-01",
          kind: "APORTE",
          amount_cents: 500000,
          description: "Old aporte",
        },
      ],
      cashImportId,
    );
  });
  try {
    const out = await getPortfolioSummary({}, { db, now });
    assert.equal(out.cash_flow_summary, null);
    assert.ok(
      out.warnings.some((w) =>
        w.includes("No cash flows imported yet; cash_flow_summary unavailable"),
      ),
      `expected cash-flow warning, got: ${JSON.stringify(out.warnings)}`,
    );
  } finally {
    cleanup();
  }
});
