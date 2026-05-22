import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { applySchema } from "../storage/schema.js";
import { importBankExtractPdf } from "./import-bank-extract-pdf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TXT = join(
  HERE,
  "..",
  "..",
  "tests",
  "fixtures",
  "extrato-bank-sample-anon.txt",
);

function withTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xp-mcp-imp-bank-"));
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

/**
 * Injected parser used by tests: reads a text file and delegates to
 * `parseBankExtractText` directly, bypassing `pdf-parse`.
 */
function fakeParserForFixture() {
  return async (filePath: string) => {
    const { parseBankExtractText } =
      await import("../adapters/xp/pdf-bank-extract.js");
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(filePath, "utf8");
    return parseBankExtractText(text, 2026);
  };
}

test("importBankExtractPdf: imports 6 cash flows from the fixture (3 APORTE + 3 RESGATE)", async () => {
  const { db, cleanup } = withTempDb();
  try {
    const result = await importBankExtractPdf(
      { file_path: FIXTURE_TXT },
      { db, parser: fakeParserForFixture() },
    );
    assert.equal(result.ok, true);
    assert.equal(result.imported, 6);
    assert.equal(result.skipped, 0);
    assert.equal(result.ignored_lines, 3);
    assert.equal(result.period_from, "2025-11-23");
    assert.equal(result.period_to, "2026-05-22");
    assert.ok(Array.isArray(result.preview));
    assert.ok(result.preview.length > 0);
  } finally {
    cleanup();
  }
});

test("importBankExtractPdf: re-importing the same file is idempotent", async () => {
  const { db, cleanup } = withTempDb();
  try {
    const first = await importBankExtractPdf(
      { file_path: FIXTURE_TXT },
      { db, parser: fakeParserForFixture() },
    );
    const second = await importBankExtractPdf(
      { file_path: FIXTURE_TXT },
      { db, parser: fakeParserForFixture() },
    );
    assert.equal(first.imported, 6);
    assert.equal(second.imported, 0);
    assert.equal(second.skipped, 6);

    const total = db.prepare("SELECT COUNT(*) AS c FROM cash_flows").get() as {
      c: number;
    };
    assert.equal(total.c, 6);
  } finally {
    cleanup();
  }
});

test("importBankExtractPdf: throws when file does not exist", async () => {
  const { db, cleanup } = withTempDb();
  try {
    await assert.rejects(
      () =>
        importBankExtractPdf(
          { file_path: "/tmp/does-not-exist-xp.pdf" },
          { db, parser: fakeParserForFixture() },
        ),
      /ENOENT|Not a file/i,
    );
  } finally {
    cleanup();
  }
});

test("importBankExtractPdf: handles wrong-document case (zero transfers)", async () => {
  const { db, cleanup } = withTempDb();
  try {
    const dir = mkdtempSync(join(tmpdir(), "xp-mcp-wrong-"));
    const wrongPath = join(dir, "wrong.txt");
    writeFileSync(
      wrongPath,
      "Conta Digital Extrato\n21/05/26 às 09:34:47Pix recebido de FelipeR$ 170,00R$ 717,14\n",
    );
    try {
      const result = await importBankExtractPdf(
        { file_path: wrongPath },
        { db, parser: fakeParserForFixture() },
      );
      assert.equal(result.imported, 0);
      assert.equal(result.ignored_lines, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } finally {
    cleanup();
  }
});

test("importBankExtractPdf: persists an imports row with source_type='pdf_bank_extract'", async () => {
  const { db, cleanup } = withTempDb();
  try {
    await importBankExtractPdf(
      { file_path: FIXTURE_TXT },
      { db, parser: fakeParserForFixture() },
    );
    const row = db
      .prepare(
        "SELECT source_type, reference_date FROM imports ORDER BY id DESC LIMIT 1",
      )
      .get() as { source_type: string; reference_date: string | null };
    assert.equal(row.source_type, "pdf_bank_extract");
    assert.equal(row.reference_date, "2026-05-22");
  } finally {
    cleanup();
  }
});
