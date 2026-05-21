import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNotesForDeclared } from "./notes-backfill.js";

test("extracts patrimonio_total_cents and reference_date from v1 notes", () => {
  const notes =
    "reference_date=2026-05-13\npatrimonio_total_cents=3123666\nsome warning here";
  assert.deepEqual(parseNotesForDeclared(notes), {
    declared_total_cents: 3123666,
    reference_date: "2026-05-13",
  });
});

test("returns nulls when keys absent", () => {
  assert.deepEqual(parseNotesForDeclared("just a free-form warning"), {
    declared_total_cents: null,
    reference_date: null,
  });
});

test("handles only one of the two keys present", () => {
  assert.deepEqual(parseNotesForDeclared("patrimonio_total_cents=500000"), {
    declared_total_cents: 500000,
    reference_date: null,
  });
  assert.deepEqual(parseNotesForDeclared("reference_date=2025-12-01"), {
    declared_total_cents: null,
    reference_date: "2025-12-01",
  });
});

test("ignores malformed values", () => {
  assert.deepEqual(
    parseNotesForDeclared(
      "patrimonio_total_cents=not-a-number\nreference_date=not-a-date",
    ),
    {
      declared_total_cents: null,
      reference_date: null,
    },
  );
});

test("returns nulls for null/empty input", () => {
  assert.deepEqual(parseNotesForDeclared(null), {
    declared_total_cents: null,
    reference_date: null,
  });
  assert.deepEqual(parseNotesForDeclared(""), {
    declared_total_cents: null,
    reference_date: null,
  });
});
