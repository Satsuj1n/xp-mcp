import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "./schema.js";
import { getLastDeclaredImport } from "./imports-repo.js";

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
