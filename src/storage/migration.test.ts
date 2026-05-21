import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrateV1ToV2 } from "./migration.js";

function withTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-migration-"));
  const db = new Database(join(dir, "data.db"));
  return {
    db,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeV1Schema(db: Database.Database): void {
  db.prepare(
    `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ).run();
  db.prepare(
    `CREATE TABLE imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_path TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    rows_total INTEGER NOT NULL DEFAULT 0,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    rows_updated INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  )`,
  ).run();
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', '1')`,
  ).run();
}

test("adds declared_total_cents and reference_date columns", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV1Schema(db);
    migrateV1ToV2(db);
    const cols = db.prepare("PRAGMA table_info(imports)").all() as {
      name: string;
    }[];
    const names = cols.map((c) => c.name);
    assert.ok(
      names.includes("declared_total_cents"),
      "declared_total_cents column missing",
    );
    assert.ok(
      names.includes("reference_date"),
      "reference_date column missing",
    );
  } finally {
    cleanup();
  }
});

test("backfills declared columns from v1 notes", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV1Schema(db);
    db.prepare(
      `INSERT INTO imports (source_type, source_path, notes) VALUES (?, ?, ?)`,
    ).run(
      "pdf_xperformance",
      "/tmp/x.pdf",
      "reference_date=2026-05-13\npatrimonio_total_cents=3123666",
    );
    migrateV1ToV2(db);
    const row = db
      .prepare("SELECT declared_total_cents, reference_date FROM imports")
      .get() as {
      declared_total_cents: number | null;
      reference_date: string | null;
    };
    assert.equal(row.declared_total_cents, 3123666);
    assert.equal(row.reference_date, "2026-05-13");
  } finally {
    cleanup();
  }
});

test("leaves nulls for imports without declared info in notes", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV1Schema(db);
    db.prepare(
      `INSERT INTO imports (source_type, source_path, notes) VALUES (?, ?, ?)`,
    ).run("csv_extract", "/tmp/y.csv", null);
    migrateV1ToV2(db);
    const row = db
      .prepare("SELECT declared_total_cents, reference_date FROM imports")
      .get() as {
      declared_total_cents: number | null;
      reference_date: string | null;
    };
    assert.equal(row.declared_total_cents, null);
    assert.equal(row.reference_date, null);
  } finally {
    cleanup();
  }
});

test("updates meta.schema_version to '2'", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV1Schema(db);
    migrateV1ToV2(db);
    const row = db
      .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
      .get() as { value: string };
    assert.equal(row.value, "2");
  } finally {
    cleanup();
  }
});

test("is idempotent (re-running does not error or change data)", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV1Schema(db);
    db.prepare(
      `INSERT INTO imports (source_type, source_path, notes) VALUES (?, ?, ?)`,
    ).run("pdf_xperformance", "/tmp/x.pdf", "patrimonio_total_cents=500000");
    migrateV1ToV2(db);
    const before = db.prepare("SELECT declared_total_cents FROM imports").get();
    migrateV1ToV2(db); // re-run
    const after = db.prepare("SELECT declared_total_cents FROM imports").get();
    assert.deepEqual(after, before);
  } finally {
    cleanup();
  }
});
