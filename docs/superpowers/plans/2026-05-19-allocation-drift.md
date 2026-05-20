# `calculate_allocation_drift` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.2.0 of `xp-mcp` with the `calculate_allocation_drift` MCP tool — the project's feature killer. Given a target allocation JSON, the tool returns drift per asset class with BRL deltas and BUY/SELL suggestions.

**Architecture:** Three new modules following the project's existing layout. `parsers/allocation-target.ts` owns I/O and JSON validation via zod. `services/drift.ts` is a pure function (zero I/O, fully unit-testable) that takes positions + target and returns the drift report. `tools/calculate-allocation-drift.ts` is the thin MCP boundary that orchestrates `listPositions` + `loadAllocationTarget` + `computeDrift`. No schema migration — target lives in `~/.xp-mcp/allocation.json`.

**Tech Stack:** TypeScript (ESM, `.js` imports), `@modelcontextprotocol/sdk`, `zod`, `better-sqlite3` (reused via existing `getDb`), Node built-in `node:test` + `tsx`.

**Source spec:** [`docs/superpowers/specs/2026-05-19-allocation-drift-design.md`](../specs/2026-05-19-allocation-drift-design.md)

---

## File Structure

**New files (created in this plan):**

| Path | Purpose |
|---|---|
| `src/parsers/allocation-target.ts` | Load + validate `allocation.json`; export `loadAllocationTarget` and `AllocationTarget` type |
| `src/parsers/allocation-target.test.ts` | Unit tests for the parser (9 cases) |
| `src/services/drift.ts` | Pure `computeDrift(positions, target)` function; exports `DriftReport`, `DriftRow` types |
| `src/services/drift.test.ts` | Unit tests for the pure function (12 cases) |
| `src/tools/calculate-allocation-drift.ts` | Thin MCP tool handler |
| `examples/allocation.example.json` | Reference target file for new users |

**Modified files:**

| Path | Change |
|---|---|
| `src/index.ts` | Register `calculate_allocation_drift` in the `TOOLS` map |
| `package.json` | Bump `version` to `0.2.0` |
| `.github/workflows/ci.yml` | Smoke test asserts the new tool name is listed |
| `README.md` | Move `calculate_allocation_drift` row from ⏳ to ✅; add demo prompt + example file reference |

---

## Task 1: Bump version and seed examples directory

**Files:**

- Create: `examples/allocation.example.json`
- Modify: `package.json` (version bump only)

- [ ] **Step 1: Bump package version to 0.2.0**

Edit `package.json`, change `"version": "0.1.0"` to `"version": "0.2.0"`.

- [ ] **Step 2: Create example allocation file**

Create `examples/allocation.example.json` with:

```json
{
  "target_allocation": {
    "TESOURO": 0.40,
    "RENDA_FIXA_PRIVADA": 0.20,
    "FII": 0.15,
    "ACAO": 0.15,
    "ETF": 0.05,
    "FUNDO": 0.05
  },
  "tolerance_pp": 2.0
}
```

- [ ] **Step 3: Verify version and example**

Run:

```bash
node -e "console.log(require('./package.json').version)"
cat examples/allocation.example.json | python3 -m json.tool
```

Expected: `0.2.0` printed, then the JSON re-pretty-printed (validates JSON syntax).

- [ ] **Step 4: Commit**

```bash
git add package.json examples/allocation.example.json
git commit -m "chore: bump version to 0.2.0 and add allocation.example.json"
```

---

## Task 2: Write failing tests for `parsers/allocation-target.ts`

**Files:**

- Create: `src/parsers/allocation-target.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/parsers/allocation-target.test.ts`:

```typescript
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
  const file = writeTmp(
    JSON.stringify({ target_allocation: { "AÇÃO": 1.0 } }),
  );
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
    assert.throws(
      () => loadAllocationTarget(file),
      /sums to 0\.9/,
    );
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
    assert.throws(
      () => loadAllocationTarget(file),
      /Invalid JSON/,
    );
  } finally {
    fs.unlinkSync(file);
  }
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:

```bash
npm test -- --test-name-pattern="allocation"
```

Expected: 9 test failures, each citing `ERR_MODULE_NOT_FOUND` or similar for `./allocation-target.js`. The fact that the test runner picks the file up is the success condition for this step.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/parsers/allocation-target.test.ts
git commit -m "test: add failing tests for allocation-target parser"
```

---

## Task 3: Implement `parsers/allocation-target.ts` to make tests pass

**Files:**

- Create: `src/parsers/allocation-target.ts`

- [ ] **Step 1: Write the implementation**

Create `src/parsers/allocation-target.ts`:

```typescript
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { z } from "zod";
import { ASSET_CLASSES, type AssetClass } from "../storage/schema.js";

const DEFAULT_TARGET_PATH = path.join(
  os.homedir(),
  ".xp-mcp",
  "allocation.json",
);

const MISSING_FILE_EXAMPLE = `{
  "target_allocation": {
    "TESOURO": 0.40,
    "RENDA_FIXA_PRIVADA": 0.20,
    "FII": 0.15,
    "ACAO": 0.15,
    "ETF": 0.05,
    "FUNDO": 0.05
  },
  "tolerance_pp": 2.0
}`;

/**
 * Strict zod schema for target_allocation: only AssetClass keys allowed,
 * each value in [0, 1], sum within 1.00 ± 0.001.
 */
const targetAllocationSchema = z
  .object({
    TESOURO: z.number().min(0).max(1).optional(),
    RENDA_FIXA_PRIVADA: z.number().min(0).max(1).optional(),
    FII: z.number().min(0).max(1).optional(),
    ETF: z.number().min(0).max(1).optional(),
    ACAO: z.number().min(0).max(1).optional(),
    FUNDO: z.number().min(0).max(1).optional(),
  })
  .strict()
  .refine(
    (alloc) => {
      const sum = Object.values(alloc).reduce<number>(
        (a, b) => a + (b ?? 0),
        0,
      );
      return Math.abs(sum - 1) <= 0.001;
    },
    (alloc) => {
      const sum = Object.values(alloc).reduce<number>(
        (a, b) => a + (b ?? 0),
        0,
      );
      return {
        message: `target_allocation sums to ${sum.toFixed(4)}, expected 1.00 (±0.001)`,
      };
    },
  );

const fullSchema = z
  .object({
    target_allocation: targetAllocationSchema,
    tolerance_pp: z.number().nonnegative().optional(),
  })
  .passthrough(); // allow future top-level fields without breaking older files

export interface AllocationTarget {
  target_allocation: Partial<Record<AssetClass, number>>;
  tolerance_pp: number | null;
  source_path: string;
}

/**
 * Pre-validate target_allocation keys before zod sees them, so we can produce
 * a helpful error message that lists the valid classes. zod's `.strict()` would
 * also reject unknown keys, but the default message is less actionable.
 */
function checkKeys(raw: unknown, sourcePath: string): void {
  if (typeof raw !== "object" || raw === null) return;
  const obj = raw as Record<string, unknown>;
  const targetAlloc = obj.target_allocation;
  if (typeof targetAlloc !== "object" || targetAlloc === null) return;

  const validKeys = new Set<string>(ASSET_CLASSES);
  for (const key of Object.keys(targetAlloc as Record<string, unknown>)) {
    if (!validKeys.has(key)) {
      throw new Error(
        `Unknown asset_class '${key}' in target_allocation at ${sourcePath}. ` +
          `Valid classes: ${ASSET_CLASSES.join(", ")}`,
      );
    }
  }
}

export function loadAllocationTarget(targetPath?: string): AllocationTarget {
  const explicit = targetPath != null;
  const resolved = targetPath ?? DEFAULT_TARGET_PATH;

  if (!fs.existsSync(resolved)) {
    if (explicit) {
      throw new Error(`Allocation target not found at ${resolved}`);
    }
    throw new Error(
      `Allocation target not found at ${resolved}.\n` +
        `Create it with:\n${MISSING_FILE_EXAMPLE}`,
    );
  }

  const raw = fs.readFileSync(resolved, "utf-8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid JSON in ${resolved}: ${msg}`);
  }

  // Custom key check before zod for a friendlier message.
  checkKeys(json, resolved);

  const parsed = fullSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Invalid allocation target at ${resolved}: ${parsed.error.message}`,
    );
  }

  return {
    target_allocation: parsed.data.target_allocation,
    tolerance_pp: parsed.data.tolerance_pp ?? null,
    source_path: resolved,
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
npm test -- --test-name-pattern="allocation"
```

Expected: 9 tests pass. If the "default missing path" test was skipped because `~/.xp-mcp/allocation.json` exists on the dev machine, that is acceptable — the CI environment will exercise it.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/parsers/allocation-target.ts
git commit -m "feat: implement loadAllocationTarget parser with zod validation"
```

---

## Task 4: Write failing tests for `services/drift.ts`

**Files:**

- Create: `src/services/drift.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/services/drift.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDrift } from "./drift.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AssetClass } from "../storage/schema.js";
import type { AllocationTarget } from "../parsers/allocation-target.js";

function mkPosition(
  cls: AssetClass,
  marketCents: number | null,
  importedAt = "2026-05-12 00:00:00",
): PositionRow {
  return {
    id: 1,
    asset_class: cls,
    external_id: `${cls}_TEST`,
    name: cls,
    quantity: 1,
    avg_price_cents: null,
    current_price_cents: null,
    invested_cents: null,
    market_value_cents: marketCents,
    issuer: null,
    indexer: null,
    rate: null,
    maturity_date: null,
    has_fgc: null,
    last_imported_at: importedAt,
  };
}

function mkTarget(
  allocation: Partial<Record<AssetClass, number>>,
  tolerance_pp: number | null = null,
): AllocationTarget {
  return {
    target_allocation: allocation,
    tolerance_pp,
    source_path: "/fake/allocation.json",
  };
}

test("empty positions → drift=[], total=0, no-positions warning", () => {
  const r = computeDrift([], mkTarget({ TESOURO: 1.0 }));
  assert.equal(r.total_brl, 0);
  assert.deepEqual(r.drift, []);
  assert.ok(r.warnings.some((w) => w.includes("No positions")));
});

test("drift=0 with no tolerance → status='ok' (zero is within tolerance=0)", () => {
  const positions = [mkPosition("TESOURO", 100_000)];
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  assert.equal(r.drift.length, 1);
  assert.equal(r.drift[0].status, "ok");
  assert.equal(r.drift[0].action, null);
  assert.equal(r.drift[0].drift_pp, 0);
});

test("overweight with tolerance band → SELL with exact amount", () => {
  // Total 1000 = TESOURO 600 + FII 400. Target 50/50.
  // TESOURO 60% vs 50% → drift +10pp, > tolerance 2 → SELL 100
  const positions = [
    mkPosition("TESOURO", 60_000),
    mkPosition("FII", 40_000),
  ];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }, 2.0));
  const tesouro = r.drift.find((d) => d.asset_class === "TESOURO");
  assert.ok(tesouro);
  assert.equal(tesouro.status, "overweight");
  assert.deepEqual(tesouro.action, { side: "SELL", amount_brl: 100 });
});

test("underweight → BUY", () => {
  const positions = [
    mkPosition("TESOURO", 40_000),
    mkPosition("FII", 60_000),
  ];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }));
  const tesouro = r.drift.find((d) => d.asset_class === "TESOURO");
  assert.ok(tesouro);
  assert.equal(tesouro.status, "underweight");
  assert.deepEqual(tesouro.action, { side: "BUY", amount_brl: 100 });
});

test("class in target but absent from positions → BUY of target_brl", () => {
  const positions = [mkPosition("TESOURO", 100_000)];
  const r = computeDrift(
    positions,
    mkTarget({ TESOURO: 0.5, ETF: 0.5 }),
  );
  const etf = r.drift.find((d) => d.asset_class === "ETF");
  assert.ok(etf);
  assert.equal(etf.current_brl, 0);
  assert.equal(etf.target_brl, 500);
  assert.deepEqual(etf.action, { side: "BUY", amount_brl: 500 });
});

test("class in positions but absent from target → SELL full amount", () => {
  const positions = [
    mkPosition("TESOURO", 50_000),
    mkPosition("FUNDO", 50_000),
  ];
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  const fundo = r.drift.find((d) => d.asset_class === "FUNDO");
  assert.ok(fundo);
  assert.equal(fundo.target_pct, 0);
  assert.equal(fundo.target_brl, 0);
  assert.equal(fundo.status, "overweight");
  assert.deepEqual(fundo.action, { side: "SELL", amount_brl: 500 });
});

test("class with current=0 AND target=0 is filtered out", () => {
  const positions = [mkPosition("TESOURO", 100_000)];
  // Target lists only TESOURO; ETF has 0 current AND 0 target → filtered
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  assert.equal(r.drift.length, 1);
  assert.equal(r.drift[0].asset_class, "TESOURO");
});

test("tolerance band: drift within → ok, action=null", () => {
  // 51.5% vs 50% → 1.5pp, within tolerance 2 → ok
  const positions = [
    mkPosition("TESOURO", 51_500),
    mkPosition("FII", 48_500),
  ];
  const r = computeDrift(
    positions,
    mkTarget({ TESOURO: 0.5, FII: 0.5 }, 2.0),
  );
  for (const row of r.drift) {
    assert.equal(row.status, "ok");
    assert.equal(row.action, null);
  }
});

test("tolerance band: drift just outside → action present", () => {
  // 52.5% vs 50% → 2.5pp > tolerance 2 → overweight
  const positions = [
    mkPosition("TESOURO", 52_500),
    mkPosition("FII", 47_500),
  ];
  const r = computeDrift(
    positions,
    mkTarget({ TESOURO: 0.5, FII: 0.5 }, 2.0),
  );
  const tesouro = r.drift.find((d) => d.asset_class === "TESOURO");
  assert.ok(tesouro);
  assert.equal(tesouro.status, "overweight");
  assert.ok(tesouro.action);
});

test("rebalance_net_brl ≈ 0 across multi-class fixture", () => {
  const positions = [
    mkPosition("TESOURO", 60_000),
    mkPosition("FII", 40_000),
  ];
  const r = computeDrift(positions, mkTarget({ TESOURO: 0.5, FII: 0.5 }));
  assert.ok(Math.abs(r.rebalance_net_brl) <= 0.02);
});

test("ordering: rows sorted by |drift_pp| descending", () => {
  // TESOURO 80% vs 50% → +30; FII 10% vs 30% → -20; ACAO 10% vs 20% → -10
  const positions = [
    mkPosition("TESOURO", 80_000),
    mkPosition("FII", 10_000),
    mkPosition("ACAO", 10_000),
  ];
  const r = computeDrift(
    positions,
    mkTarget({ TESOURO: 0.5, FII: 0.3, ACAO: 0.2 }),
  );
  assert.equal(r.drift[0].asset_class, "TESOURO");
  assert.equal(r.drift[1].asset_class, "FII");
  assert.equal(r.drift[2].asset_class, "ACAO");
});

test("position with null market_value_cents is skipped and warned", () => {
  const positions = [
    mkPosition("TESOURO", 100_000),
    mkPosition("FII", null),
  ];
  const r = computeDrift(positions, mkTarget({ TESOURO: 1.0 }));
  assert.ok(
    r.warnings.some(
      (w) => w.includes("1 position") && w.includes("skipped"),
    ),
  );
});

test("reference_date is the max last_imported_at across positions", () => {
  const positions = [
    mkPosition("TESOURO", 67_000, "2026-05-10 00:00:00"),
    mkPosition("FII", 33_000, "2026-05-15 00:00:00"),
  ];
  const r = computeDrift(
    positions,
    mkTarget({ TESOURO: 0.67, FII: 0.33 }),
  );
  assert.equal(r.reference_date, "2026-05-15 00:00:00");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run:

```bash
npm test -- --test-name-pattern="drift|reference_date|rebalance|ordering|tolerance|overweight|underweight|empty positions|filtered"
```

Expected: 13 test failures, all citing `ERR_MODULE_NOT_FOUND` for `./drift.js`.

- [ ] **Step 3: Commit failing tests**

```bash
git add src/services/drift.test.ts
git commit -m "test: add failing tests for computeDrift pure function"
```

---

## Task 5: Implement `services/drift.ts` to make tests pass

**Files:**

- Create: `src/services/drift.ts`

- [ ] **Step 1: Write the implementation**

Create `src/services/drift.ts`:

```typescript
import type { AssetClass } from "../storage/schema.js";
import type { PositionRow } from "../storage/positions-repo.js";
import type { AllocationTarget } from "../parsers/allocation-target.js";

export interface DriftRow {
  asset_class: AssetClass;
  current_brl: number;
  current_pct: number;
  target_pct: number;
  target_brl: number;
  drift_pp: number; // signed: positive = overweight
  status: "ok" | "overweight" | "underweight";
  action: { side: "BUY" | "SELL"; amount_brl: number } | null;
}

export interface DriftReport {
  total_brl: number;
  tolerance_pp: number | null;
  target_path: string;
  reference_date: string | null;
  drift: DriftRow[];
  rebalance_net_brl: number;
  warnings: string[];
}

/**
 * Round to 2 decimals (BRL precision). Math is done in cents; this is
 * used only at the output boundary to avoid IEEE 754 noise like
 * `13.130000000000001`.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Pure function: given positions and a target, compute the drift report.
 * Never touches the filesystem, the database, or the network.
 */
export function computeDrift(
  positions: PositionRow[],
  target: AllocationTarget,
): DriftReport {
  // tolerance_pp absent ⇒ treat as 0 (unifying defaults)
  const tolerance = target.tolerance_pp ?? 0;
  const warnings: string[] = [];

  // 1) Aggregate market values by asset_class, in cents.
  const byClassCents = new Map<AssetClass, number>();
  let skipped = 0;
  let latestImport: string | null = null;

  for (const p of positions) {
    if (p.market_value_cents == null) {
      skipped++;
      continue;
    }
    byClassCents.set(
      p.asset_class,
      (byClassCents.get(p.asset_class) ?? 0) + p.market_value_cents,
    );
    if (latestImport == null || p.last_imported_at > latestImport) {
      latestImport = p.last_imported_at;
    }
  }

  if (skipped > 0) {
    warnings.push(`${skipped} position${skipped === 1 ? "" : "s"} skipped (no market value)`);
  }

  if (positions.length === 0) {
    warnings.push(
      "No positions in database. Run import_xperformance_pdf or import_extract_csv first.",
    );
  }

  const totalCents = Array.from(byClassCents.values()).reduce(
    (a, b) => a + b,
    0,
  );

  // 2) Union of asset classes from positions ∪ target
  const targetKeys = Object.keys(target.target_allocation) as AssetClass[];
  const allClasses = new Set<AssetClass>([
    ...byClassCents.keys(),
    ...targetKeys,
  ]);

  // 3) Build one row per class (filter degenerate 0/0)
  const rows: DriftRow[] = [];
  for (const cls of allClasses) {
    const currentCents = byClassCents.get(cls) ?? 0;
    const targetPct = target.target_allocation[cls] ?? 0;

    if (currentCents === 0 && targetPct === 0) continue;

    const currentPct = totalCents > 0 ? currentCents / totalCents : 0;
    const targetCents = Math.round(targetPct * totalCents);
    const driftPp = round2((currentPct - targetPct) * 100); // signed, 2dp
    const deltaCents = currentCents - targetCents; // + → sell, − → buy

    let status: DriftRow["status"];
    let action: DriftRow["action"];

    if (Math.abs(driftPp) <= tolerance) {
      status = "ok";
      action = null;
    } else if (driftPp > 0) {
      status = "overweight";
      action = { side: "SELL", amount_brl: round2(deltaCents / 100) };
    } else {
      status = "underweight";
      action = { side: "BUY", amount_brl: round2(-deltaCents / 100) };
    }

    rows.push({
      asset_class: cls,
      current_brl: round2(currentCents / 100),
      current_pct: currentPct,
      target_pct: targetPct,
      target_brl: round2(targetCents / 100),
      drift_pp: driftPp,
      status,
      action,
    });
  }

  // 4) Sort by |drift_pp| descending — surface biggest problems first.
  rows.sort((a, b) => Math.abs(b.drift_pp) - Math.abs(a.drift_pp));

  // 5) Self-consistency: SELL total minus BUY total should be ≈ 0.
  let net = 0;
  for (const r of rows) {
    if (r.action?.side === "SELL") net += r.action.amount_brl;
    if (r.action?.side === "BUY") net -= r.action.amount_brl;
  }
  if (Math.abs(net) > 0.02) {
    warnings.push(`rebalance_net_brl is ${net.toFixed(2)} (expected ≈ 0; math bug suspected)`);
  }

  return {
    total_brl: round2(totalCents / 100),
    tolerance_pp: target.tolerance_pp,
    target_path: target.source_path,
    reference_date: latestImport,
    drift: rows,
    rebalance_net_brl: round2(net),
    warnings,
  };
}
```

- [ ] **Step 2: Run the drift tests**

Run:

```bash
npm test -- --test-name-pattern="drift|reference_date|rebalance|ordering|tolerance|overweight|underweight|empty positions|filtered"
```

Expected: all 13 drift tests pass.

- [ ] **Step 3: Run the full test suite + typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/drift.ts
git commit -m "feat: implement computeDrift pure function for allocation drift"
```

---

## Task 6: Implement the MCP tool and register it in `index.ts`

**Files:**

- Create: `src/tools/calculate-allocation-drift.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create the tool file**

Create `src/tools/calculate-allocation-drift.ts`:

```typescript
import { z } from "zod";
import { getDb } from "../storage/db.js";
import { listPositions } from "../storage/positions-repo.js";
import { loadAllocationTarget } from "../parsers/allocation-target.js";
import { computeDrift, type DriftReport } from "../services/drift.js";

export const calculateAllocationDriftSchema = z.object({
  target_path: z
    .string()
    .optional()
    .describe(
      "Absolute path to a target allocation JSON file. " +
        "Defaults to ~/.xp-mcp/allocation.json. " +
        "The file must have shape { target_allocation: { TESOURO: 0.4, ... }, tolerance_pp?: number }.",
    ),
});

export type CalculateAllocationDriftInput = z.infer<
  typeof calculateAllocationDriftSchema
>;

export async function calculateAllocationDrift(
  input: CalculateAllocationDriftInput,
): Promise<DriftReport> {
  const target = loadAllocationTarget(input.target_path);
  const db = getDb();
  const positions = listPositions(db);
  return computeDrift(positions, target);
}
```

- [ ] **Step 2: Register the tool in `index.ts`**

Edit `src/index.ts`. Add the import alongside the other tool imports:

```typescript
import {
  calculateAllocationDrift,
  calculateAllocationDriftSchema,
} from "./tools/calculate-allocation-drift.js";
```

Then add this entry inside the `TOOLS` object (after the existing `get_positions` entry):

```typescript
  calculate_allocation_drift: {
    description:
      "Compare current portfolio allocation against a target defined in ~/.xp-mcp/allocation.json. " +
      "Returns per-class drift in percentage points and BRL, with suggested BUY/SELL actions to rebalance. " +
      "Optional 'target_path' argument overrides the default location. " +
      "Optional 'tolerance_pp' field in the JSON treats drifts within the band as 'ok' (no action).",
    schema: calculateAllocationDriftSchema,
    handler: calculateAllocationDrift,
  },
```

- [ ] **Step 3: Build and smoke-test locally**

Run:

```bash
npm run build
node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

Expected: the `tools/list` response includes `calculate_allocation_drift` alongside the three existing tools.

- [ ] **Step 4: Smoke-test the tool against the example file**

Run:

```bash
node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"calculate_allocation_drift","arguments":{"target_path":"/Users/felipelima/Documents/xp_mcp/examples/allocation.example.json"}}}
EOF
```

Expected: a JSON response containing `total_brl`, `drift` array, `rebalance_net_brl`. Values depend on the local DB state (the user's real data is there from earlier in this session). The shape is what's being verified.

- [ ] **Step 5: Commit**

```bash
git add src/tools/calculate-allocation-drift.ts src/index.ts
git commit -m "feat: register calculate_allocation_drift MCP tool"
```

---

## Task 7: Update CI smoke test and README

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`

- [ ] **Step 1: Add the new tool to the CI smoke test**

Edit `.github/workflows/ci.yml`. In the `Smoke test MCP server` step, the existing grep commands look like:

```yaml
          echo "$OUTPUT" | grep -q '"name":"get_positions"' || (echo "Smoke test failed — get_positions not registered" && exit 1)
          echo "$OUTPUT" | grep -q '"name":"import_xperformance_pdf"' || (echo "Smoke test failed — import_xperformance_pdf not registered" && exit 1)
          echo "All 3 tools registered correctly"
```

Replace those three lines with:

```yaml
          echo "$OUTPUT" | grep -q '"name":"get_positions"' || (echo "Smoke test failed — get_positions not registered" && exit 1)
          echo "$OUTPUT" | grep -q '"name":"import_xperformance_pdf"' || (echo "Smoke test failed — import_xperformance_pdf not registered" && exit 1)
          echo "$OUTPUT" | grep -q '"name":"calculate_allocation_drift"' || (echo "Smoke test failed — calculate_allocation_drift not registered" && exit 1)
          echo "All 4 tools registered correctly"
```

- [ ] **Step 2: Update README tools table**

Edit `README.md`. In the *Tools* section, change the `calculate_allocation_drift` row from `⏳` to `✅`, and update its description to reflect the shipped behavior. Replace this row:

```markdown
| `calculate_allocation_drift`  | Compare current vs target allocation from `~/.xp-mcp/allocation.json`                  |   ⏳   |
```

with:

```markdown
| `calculate_allocation_drift`  | Compare current vs target allocation from `~/.xp-mcp/allocation.json`. Returns drift %, BRL delta, and BUY/SELL suggestions per class. |   ✅   |
```

- [ ] **Step 3: Add a demo prompt + example file pointer to the README**

In `README.md`, inside the *Demo* section's code block (the one starting with `You: Liste minhas posições...`), append before the closing triple-backtick:

```text

You: Estou bem alocado em relação ao meu target?

Claude (using xp-mcp.calculate_allocation_drift):
  Lendo ~/.xp-mcp/allocation.json (target: 40% Tesouro, 20% RF, 15% FII,
  15% Ações, 5% ETF, 5% Fundos, tolerância ±2pp).

  Mais fora do alvo:
    • TESOURO:  53.13%  (target 40%)  → vender ~R$ 4.111
    • FII:       7.87%  (target 15%)  → comprar ~R$ 2.231
    • ETF:       0.00%  (target  5%)  → comprar ~R$ 1.566

  Dentro da banda:
    • RENDA_FIXA_PRIVADA: 20.91% (target 20%) ✓
    • ACAO:                7.63% (target 15%) — fora da banda mas perto

  Net rebalance: R$ 0,00 (sane).
```

Then, in the *How to export from XP* section or in a new dedicated section called *Configuring your target allocation*, add (right after step 5 of the export list):

````markdown

### Configuring your target allocation

`calculate_allocation_drift` reads `~/.xp-mcp/allocation.json`. A starter file is included at [`examples/allocation.example.json`](./examples/allocation.example.json). Copy it once and edit the percentages:

```bash
mkdir -p ~/.xp-mcp
cp examples/allocation.example.json ~/.xp-mcp/allocation.json
```

The six valid keys are `TESOURO`, `RENDA_FIXA_PRIVADA`, `FII`, `ETF`, `ACAO`, `FUNDO`. Values must sum to `1.00` (±0.001). `tolerance_pp` is optional — when set, drifts within the band are reported as `"ok"` with no action.
````

- [ ] **Step 4: Update the Roadmap section**

In `README.md`, in the *Roadmap* section, change:

```markdown
- [ ] `calculate_allocation_drift` against `~/.xp-mcp/allocation.json`
```

to:

```markdown
- [x] `calculate_allocation_drift` against `~/.xp-mcp/allocation.json`
```

- [ ] **Step 5: Commit and push**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "docs: mark calculate_allocation_drift as shipped; update CI smoke test"
git push
```

- [ ] **Step 6: Verify CI passes**

After the push, run:

```bash
sleep 15
gh run list --repo Satsuj1n/xp-mcp --limit 1 --json status,conclusion,name
```

Expected: a run with `"conclusion": "success"`. If still running, wait and re-poll.

---

## Task 8: Release v0.2.0

**Files:**

- None (release-only task).

- [ ] **Step 1: Create the annotated tag**

Run:

```bash
git tag -a v0.2.0 -m "$(cat <<'EOF'
v0.2.0 — calculate_allocation_drift

The feature killer: compare current portfolio allocation against a
user-defined target in ~/.xp-mcp/allocation.json. Returns drift in
percentage points and BRL with BUY/SELL suggestions per class.

Custodian apps never answer "how far am I from my target?" — this tool
makes Claude answer it locally with no scraping and no credentials.
EOF
)"
git push --tags
```

- [ ] **Step 2: Create the GitHub release**

Run:

````bash
cat > /tmp/release-notes-v0.2.0.md <<'EOF'
The **feature killer**: compare your current XP portfolio allocation against a target defined in `~/.xp-mcp/allocation.json`. Returns per-class drift in percentage points and BRL, with concrete BUY/SELL suggestions to rebalance.

Custodian apps never answer *"how far am I from my target?"* — this is the question this tool was built to answer.

## What's new

| Tool | Status |
|---|---|
| `calculate_allocation_drift` | ✅ NEW |

## How to use

```bash
# One-time setup
mkdir -p ~/.xp-mcp
cp examples/allocation.example.json ~/.xp-mcp/allocation.json
# Edit the percentages to your target
```

Then ask Claude:

> *"Estou bem alocado em relação ao meu target?"*

Claude calls `calculate_allocation_drift`, reads your local positions and target, and returns actionable suggestions:

```text
TESOURO:  53.13%  (target 40%)  → vender ~R$ 4.111
FII:       7.87%  (target 15%)  → comprar ~R$ 2.231
ETF:       0.00%  (target  5%)  → comprar ~R$ 1.566
```

## Design

Full spec: [`docs/superpowers/specs/2026-05-19-allocation-drift-design.md`](https://github.com/Satsuj1n/xp-mcp/blob/main/docs/superpowers/specs/2026-05-19-allocation-drift-design.md)

- Granularity: by `asset_class` (6 buckets)
- Denominator: sum of position market values (cash gap excluded)
- Storage: hand-edited JSON; `target_path` argument overrides the default
- Optional `tolerance_pp` band

## What's next

See [roadmap](https://github.com/Satsuj1n/xp-mcp#roadmap) — npm publish + Smithery listing (v0.3.0), fixtures + tests + demo GIF (v0.4.0).
EOF

gh release create v0.2.0 \
  --title "v0.2.0 — calculate_allocation_drift" \
  --notes-file /tmp/release-notes-v0.2.0.md \
  --verify-tag
````

Expected: a URL to the release page is printed.

- [ ] **Step 3: Verify final repo state**

Run:

```bash
gh repo view Satsuj1n/xp-mcp --json latestRelease,description
gh run list --repo Satsuj1n/xp-mcp --limit 1 --json status,conclusion,name
```

Expected:

- `latestRelease.tagName` is `v0.2.0`
- CI conclusion for the latest run is `success`

---

## Definition of done

- [ ] All 4 tools listed by the MCP server (verified by CI smoke test)
- [ ] `npm test` runs all 22 unit tests (9 parser + 13 drift) and they pass
- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean
- [ ] README updated: tool row ✅, demo prompt added, allocation config section added, roadmap ticked
- [ ] `examples/allocation.example.json` committed
- [ ] Git tag `v0.2.0` pushed
- [ ] GitHub release `v0.2.0` published with notes
- [ ] CI green on `main` after the final push
