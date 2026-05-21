import { test } from "node:test";
import assert from "node:assert/strict";
import { round2 } from "./money.js";

test("round2 rounds to two decimals", () => {
  assert.equal(round2(13.130000000000001), 13.13);
  assert.equal(round2(13.135), 13.14);
  assert.equal(round2(13.134), 13.13);
});

test("round2 handles zero and negatives", () => {
  assert.equal(round2(0), 0);
  assert.equal(round2(-1.005), -1.0);
  assert.equal(round2(-1.006), -1.01);
});
