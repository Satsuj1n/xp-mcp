import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "./schema.js";
import {
  getLastDeclaredImport,
  listValuationSnapshots,
} from "./imports-repo.js";
import { createImportRecord } from "./positions-repo.js";

function withTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-imports-repo-"));
  const db = new Database(join(dir, "data.db"));
  applySchema(db);
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("returns null when no imports exist", () => {
  const { db, cleanup } = withTempDb();
  try {
    assert.equal(getLastDeclaredImport(db), null);
  } finally {
    cleanup();
  }
});

test("returns null when imports exist but none has declared_total_cents", () => {
  const { db, cleanup } = withTempDb();
  try {
    db.prepare(
      "INSERT INTO imports (source_type, source_path) VALUES ('csv_extract', '/tmp/a.csv')",
    ).run();
    assert.equal(getLastDeclaredImport(db), null);
  } finally {
    cleanup();
  }
});

test("returns the most recent declared import by imported_at", () => {
  const { db, cleanup } = withTempDb();
  try {
    db.prepare(
      "INSERT INTO imports (source_type, source_path, imported_at, declared_total_cents, reference_date) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "pdf_xperformance",
      "/tmp/old.pdf",
      "2026-04-01 10:00:00",
      1000000,
      "2026-04-01",
    );
    db.prepare(
      "INSERT INTO imports (source_type, source_path, imported_at, declared_total_cents, reference_date) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "pdf_xperformance",
      "/tmp/new.pdf",
      "2026-05-21 10:00:00",
      3123666,
      "2026-05-21",
    );
    const result = getLastDeclaredImport(db);
    assert.ok(result);
    assert.equal(result!.declared_total_cents, 3123666);
    assert.equal(result!.reference_date, "2026-05-21");
    assert.equal(result!.source_path, "/tmp/new.pdf");
  } finally {
    cleanup();
  }
});

test("ignores undeclared imports newer than the latest declared", () => {
  const { db, cleanup } = withTempDb();
  try {
    db.prepare(
      "INSERT INTO imports (source_type, source_path, imported_at, declared_total_cents, reference_date) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "pdf_xperformance",
      "/tmp/declared.pdf",
      "2026-05-01 10:00:00",
      1000000,
      "2026-05-01",
    );
    db.prepare(
      "INSERT INTO imports (source_type, source_path, imported_at) VALUES (?, ?, ?)",
    ).run("csv_extract", "/tmp/newer-csv.csv", "2026-05-21 10:00:00");
    const result = getLastDeclaredImport(db);
    assert.ok(result);
    assert.equal(result!.source_path, "/tmp/declared.pdf");
  } finally {
    cleanup();
  }
});

test("listValuationSnapshots: returns only pdf_xperformance imports with declared_total_cents AND reference_date", () => {
  const { db, cleanup } = withTempDb();
  try {
    // Eligible: xperformance + declared + reference_date.
    const eligibleId = createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/eligible.pdf",
      totalRows: 1,
      declaredTotalCents: 1500000,
      referenceDate: "2026-01-31",
    });
    // Ineligible: xperformance but NULL declared_total_cents.
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/no-total.pdf",
      totalRows: 1,
      declaredTotalCents: null,
      referenceDate: "2026-02-28",
    });
    // Ineligible: wrong source_type, even with declared/reference set.
    createImportRecord(db, {
      sourceType: "csv_extract",
      sourcePath: "/tmp/csv.csv",
      totalRows: 1,
      declaredTotalCents: 2000000,
      referenceDate: "2026-03-31",
    });

    const rows = listValuationSnapshots(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].import_id, eligibleId);
    assert.equal(rows[0].declared_total_cents, 1500000);
    assert.equal(rows[0].reference_date, "2026-01-31");
    assert.ok(typeof rows[0].imported_at === "string");
  } finally {
    cleanup();
  }
});

test("listValuationSnapshots: sorted by reference_date ASC, imported_at DESC tiebreaker", () => {
  const { db, cleanup } = withTempDb();
  try {
    // Two imports share reference_date '2026-02-28' — the later imported_at
    // must come first within that group (defensive tiebreaker).
    // Use raw INSERT to control `imported_at` (createImportRecord uses
    // datetime('now') and can't fix the ordering deterministically).
    db.prepare(
      "INSERT INTO imports (source_type, source_path, imported_at, declared_total_cents, reference_date) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "pdf_xperformance",
      "/tmp/jan.pdf",
      "2026-02-01 10:00:00",
      1000000,
      "2026-01-31",
    );
    db.prepare(
      "INSERT INTO imports (source_type, source_path, imported_at, declared_total_cents, reference_date) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "pdf_xperformance",
      "/tmp/feb-older.pdf",
      "2026-03-01 10:00:00",
      2000000,
      "2026-02-28",
    );
    db.prepare(
      "INSERT INTO imports (source_type, source_path, imported_at, declared_total_cents, reference_date) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "pdf_xperformance",
      "/tmp/feb-newer.pdf",
      "2026-03-05 10:00:00",
      2100000,
      "2026-02-28",
    );

    const rows = listValuationSnapshots(db);
    assert.equal(rows.length, 3);
    // Earliest reference_date first.
    assert.equal(rows[0].reference_date, "2026-01-31");
    assert.equal(rows[0].declared_total_cents, 1000000);
    // Among the two '2026-02-28', the most recently imported wins (DESC).
    assert.equal(rows[1].reference_date, "2026-02-28");
    assert.equal(rows[1].declared_total_cents, 2100000);
    assert.equal(rows[2].reference_date, "2026-02-28");
    assert.equal(rows[2].declared_total_cents, 2000000);
  } finally {
    cleanup();
  }
});

test("listValuationSnapshots: filters by periodFrom (inclusive)", () => {
  const { db, cleanup } = withTempDb();
  try {
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/jan.pdf",
      totalRows: 1,
      declaredTotalCents: 1000000,
      referenceDate: "2026-01-31",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/feb.pdf",
      totalRows: 1,
      declaredTotalCents: 2000000,
      referenceDate: "2026-02-28",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/mar.pdf",
      totalRows: 1,
      declaredTotalCents: 3000000,
      referenceDate: "2026-03-31",
    });

    const rows = listValuationSnapshots(db, "2026-02-01");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].reference_date, "2026-02-28");
    assert.equal(rows[1].reference_date, "2026-03-31");
  } finally {
    cleanup();
  }
});

test("listValuationSnapshots: filters by periodTo (inclusive)", () => {
  const { db, cleanup } = withTempDb();
  try {
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/jan.pdf",
      totalRows: 1,
      declaredTotalCents: 1000000,
      referenceDate: "2026-01-31",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/feb.pdf",
      totalRows: 1,
      declaredTotalCents: 2000000,
      referenceDate: "2026-02-28",
    });
    createImportRecord(db, {
      sourceType: "pdf_xperformance",
      sourcePath: "/tmp/mar.pdf",
      totalRows: 1,
      declaredTotalCents: 3000000,
      referenceDate: "2026-03-31",
    });

    const rows = listValuationSnapshots(db, undefined, "2026-02-28");
    assert.equal(rows.length, 2);
    assert.equal(rows[0].reference_date, "2026-01-31");
    assert.equal(rows[1].reference_date, "2026-02-28");
  } finally {
    cleanup();
  }
});
