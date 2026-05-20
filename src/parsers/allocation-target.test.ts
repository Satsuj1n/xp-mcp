import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadAllocationTarget } from "./allocation-target.js";

function writeTmp(content: string): string {
  const p = path.join(
    os.tmpdir(),
    `xp-mcp-target-${Date.now()}-${Math.floor(Math.random() * 1e9)}.json`,
  );
  fs.writeFileSync(p, content);
  return p;
}

test("valid full JSON parses with tolerance_pp", () => {
  const file = writeTmp(
    JSON.stringify({
      target_allocation: { TESOURO: 0.5, RENDA_FIXA_PRIVADA: 0.5 },
      tolerance_pp: 2.0,
    }),
  );
  try {
    const result = loadAllocationTarget(file);
    assert.deepEqual(result.target_allocation, {
      TESOURO: 0.5,
      RENDA_FIXA_PRIVADA: 0.5,
    });
    assert.equal(result.tolerance_pp, 2.0);
    assert.equal(result.source_path, file);
  } finally {
    fs.unlinkSync(file);
  }
});

test("JSON without tolerance_pp → tolerance_pp = null", () => {
  const file = writeTmp(
    JSON.stringify({ target_allocation: { TESOURO: 1.0 } }),
  );
  try {
    const result = loadAllocationTarget(file);
    assert.equal(result.tolerance_pp, null);
  } finally {
    fs.unlinkSync(file);
  }
});

test("unknown key throws with valid-classes list", () => {
  const file = writeTmp(JSON.stringify({ target_allocation: { AÇÃO: 1.0 } }));
  try {
    assert.throws(
      () => loadAllocationTarget(file),
      (err: Error) => {
        assert.match(err.message, /AÇÃO/);
        assert.match(err.message, /TESOURO/);
        assert.match(err.message, /FII/);
        return true;
      },
    );
  } finally {
    fs.unlinkSync(file);
  }
});

test("sum != 1.0 (outside tolerance) throws with actual sum", () => {
  const file = writeTmp(
    JSON.stringify({ target_allocation: { TESOURO: 0.5, FII: 0.4 } }),
  );
  try {
    assert.throws(() => loadAllocationTarget(file), /sums to 0\.9/);
  } finally {
    fs.unlinkSync(file);
  }
});

test("sum within ±0.001 passes", () => {
  const file = writeTmp(
    JSON.stringify({ target_allocation: { TESOURO: 0.4995, FII: 0.5005 } }),
  );
  try {
    const result = loadAllocationTarget(file);
    assert.equal(result.target_allocation.TESOURO, 0.4995);
  } finally {
    fs.unlinkSync(file);
  }
});

test("negative tolerance_pp throws", () => {
  const file = writeTmp(
    JSON.stringify({
      target_allocation: { TESOURO: 1.0 },
      tolerance_pp: -1,
    }),
  );
  try {
    assert.throws(() => loadAllocationTarget(file));
  } finally {
    fs.unlinkSync(file);
  }
});

test("explicit missing path throws without example block", () => {
  assert.throws(
    () => loadAllocationTarget("/nonexistent/xp-mcp/file.json"),
    (err: Error) => {
      assert.match(err.message, /not found/);
      assert.doesNotMatch(err.message, /Create it with/);
      return true;
    },
  );
});

test("default missing path throws with example block (when default absent)", () => {
  const defaultPath = path.join(os.homedir(), ".xp-mcp", "allocation.json");
  if (fs.existsSync(defaultPath)) return; // skip if user has one
  assert.throws(
    () => loadAllocationTarget(),
    (err: Error) => {
      assert.match(err.message, /not found/);
      assert.match(err.message, /Create it with/);
      assert.match(err.message, /TESOURO/);
      return true;
    },
  );
});

test("invalid JSON throws clear error", () => {
  const file = writeTmp("{not valid json");
  try {
    assert.throws(() => loadAllocationTarget(file), /Invalid JSON/);
  } finally {
    fs.unlinkSync(file);
  }
});
