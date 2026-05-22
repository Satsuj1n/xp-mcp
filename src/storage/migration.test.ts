import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { migrateV1ToV2, migrateV2ToV3 } from "./migration.js";

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

// Frozen snapshot of the v2 `imports` schema. Update intentionally only when
// imports changes in a way that affects v3 migration tests — otherwise drift
// will silently mask migration regressions.
function makeV2Schema(db: Database.Database): void {
  // Minimum v2 schema needed for v3 migration: meta + imports.
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
    notes TEXT,
    declared_total_cents INTEGER,
    reference_date TEXT
  )`,
  ).run();
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('schema_version', '2')`,
  ).run();
}

test("v2→v3: creates cash_flows table with expected columns", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV2Schema(db);
    migrateV2ToV3(db);
    const cols = db.prepare("PRAGMA table_info(cash_flows)").all() as {
      name: string;
      notnull: number;
    }[];
    const names = cols.map((c) => c.name).sort();
    assert.deepEqual(names, [
      "amount_cents",
      "description",
      "flow_date",
      "flow_datetime",
      "id",
      "import_id",
      "kind",
    ]);

    // Verify NOT NULL constraints on financial/required columns.
    // Note: `id` is INTEGER PRIMARY KEY AUTOINCREMENT — SQLite reports notnull=0
    // even though the PK constraint prevents nulls at insertion time.
    // `import_id` is nullable per spec (FK without NOT NULL).
    const notNullCols = cols
      .filter((c) => c.notnull === 1)
      .map((c) => c.name)
      .sort();
    assert.deepEqual(notNullCols, [
      "amount_cents",
      "description",
      "flow_date",
      "flow_datetime",
      "kind",
    ]);
  } finally {
    cleanup();
  }
});

test("v2→v3: creates expected indexes", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV2Schema(db);
    migrateV2ToV3(db);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cash_flows'",
      )
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    assert.ok(names.includes("idx_cash_flows_date"));
    assert.ok(names.includes("idx_cash_flows_kind"));
  } finally {
    cleanup();
  }
});

test("v2→v3: UNIQUE (flow_datetime, amount_cents, kind) enforced", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV2Schema(db);
    migrateV2ToV3(db);
    db.prepare(
      "INSERT INTO cash_flows (flow_datetime, flow_date, kind, amount_cents, description) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "2026-05-19 07:03:19",
      "2026-05-19",
      "APORTE",
      550000,
      "Transferência enviada para conta investimento",
    );

    // description intentionally differs — it's excluded from the UNIQUE key per spec §5.1
    assert.throws(() => {
      db.prepare(
        "INSERT INTO cash_flows (flow_datetime, flow_date, kind, amount_cents, description) VALUES (?, ?, ?, ?, ?)",
      ).run(
        "2026-05-19 07:03:19",
        "2026-05-19",
        "APORTE",
        550000,
        "different description here",
      );
    }, /UNIQUE constraint failed/i);
  } finally {
    cleanup();
  }
});

test("v2→v3: idempotent (re-running does not error)", () => {
  const { db, cleanup } = withTempDb();
  try {
    makeV2Schema(db);
    migrateV2ToV3(db);
    migrateV2ToV3(db); // re-run must not throw
    const cols = db.prepare("PRAGMA table_info(cash_flows)").all() as {
      name: string;
    }[];
    assert.equal(cols.length, 7);
  } finally {
    cleanup();
  }
});
