# `calculate_allocation_drift` — Design Spec

| Field | Value |
| --- | --- |
| **Version** | v0.2.0 |
| **Author** | Felipe Lima |
| **Date** | 2026-05-19 |
| **Status** | Approved (brainstorming complete) |
| **Implements** | Roadmap item: *"`calculate_allocation_drift` against `~/.xp-mcp/allocation.json`"* |

---

## 1. Problem statement

`xp-mcp` v0.1.0 ships three tools that mirror what XP's own app already does: list positions and summarize a portfolio. None of them solve the *original justification* for the project — answering questions custodian apps refuse to answer.

The single highest-value question for a long-term portfolio holder is:

> *"How far is my current allocation from where it should be, and what do I need to buy/sell to get back on track?"*

Custodian apps never answer this because (a) they sell the trades, not the discipline, and (b) the target allocation is a personal opinion they don't own. MCP is the perfect place to layer that opinion on top of read-only data.

This spec defines the `calculate_allocation_drift` tool that ships in v0.2.0 as the project's **feature killer** — the reason someone would clone this repo instead of just opening the XP app.

## 2. Goals

- Tool returns per-class drift between current portfolio and a user-defined target
- Output is actionable: includes BRL amounts and BUY/SELL suggestions, not just percentages
- Target lives in a plain JSON file the user owns and versions
- Pure-function core is testable without DB or filesystem mocks
- Zero changes to the existing SQLite schema

## 3. Non-goals

- Multi-portfolio support (one active target only — v0.2 stays single-tenant)
- Target persistence in the database (file is the source of truth)
- Tax/IR optimization for rebalancing trades
- Price fetching to refresh `market_value_cents` (still bound to last import)
- Multiple named targets (conservative vs aggressive) — handled by `target_path` argument, not by a named-target abstraction
- Per-ticker or hierarchical (strategy → class → ticker) target schemas
- Auto-creation of `allocation.json` (user creates it; tool reads only)

## 4. Decisions log

Resolved during brainstorming. Recorded here so the implementation plan and future readers see *why*, not just *what*.

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Granularity of the target | **By `asset_class`** (6 buckets: TESOURO, RENDA_FIXA_PRIVADA, FII, ETF, ACAO, FUNDO) | Maps directly to the existing `positions.asset_class` column. No additional classifier needed. Simplest schema with non-trivial value. |
| 2 | Output content | **Drift % + BRL delta + suggested action (BUY/SELL + amount)** | Without the action, the user sees the problem but not the solution. Claude needs precise numbers to give an actionable answer. |
| 3 | Denominator for percentages | **Sum of `market_value_cents` from positions** | Asymmetric on purpose: only investable capital participates in drift. Cash gap (the R$ 25.91 observed) is excluded from rebalance math because you don't "rebalance cash that's sitting in checking". |
| 4 | Storage of the target | **`~/.xp-mcp/allocation.json`, hand-edited, with `target_path` override argument** | File is transparent, version-controllable via dotfiles, and editable in any editor. No new DB table, no second tool to write the target. |

Implicit decision (no question, default applied): **`tolerance_pp` is optional**. If the JSON omits it, every non-zero drift produces an action. If present, drifts within the band are reported as `status: "ok"` with `action: null`.

## 5. Input schema (`~/.xp-mcp/allocation.json`)

```jsonc
{
  // REQUIRED. Map of AssetClass → fraction in [0, 1].
  // Sum must equal 1.00 ± 0.001.
  // Classes omitted from this map are treated as target=0.
  // Unknown keys (not in the AssetClass enum) cause a parse error.
  "target_allocation": {
    "TESOURO": 0.40,
    "RENDA_FIXA_PRIVADA": 0.20,
    "FII": 0.15,
    "ACAO": 0.15,
    "ETF": 0.05,
    "FUNDO": 0.05
  },

  // OPTIONAL. Pontos percentuais (not fraction). Must be >= 0.
  // If present, |drift_pp| <= tolerance_pp ⇒ status="ok", action=null.
  // If absent, every non-zero drift produces an action.
  "tolerance_pp": 2.0
}
```

**Validation (strict, with useful errors):**

- Keys of `target_allocation` must be in the `AssetClass` enum. Unknown key → error listing valid options.
- Values in `[0, 1]`. Out-of-range → error with path.
- `sum(target_allocation.values()) ∈ [0.999, 1.001]`. Failure → error reporting actual sum.
- `tolerance_pp`, if present, must be a non-negative number.
- Extra top-level keys are ignored (forward-compatible for future fields).

## 6. Tool input schema (zod)

```typescript
z.object({
  target_path: z.string().optional()
    .describe(
      "Absolute path to a target allocation JSON. " +
      "Defaults to ~/.xp-mcp/allocation.json."
    ),
});
```

Single optional argument. Default resolution: `~` expanded to `os.homedir()`.

## 7. Tool output schema

```jsonc
{
  "total_brl": 31310.88,
  "tolerance_pp": 2.0,                              // null if not configured
  "target_path": "/Users/.../allocation.json",
  "reference_date": "2026-05-12",                   // from latest import row

  // Union of classes present in either positions OR target_allocation.
  // Classes with current=0 AND target=0 are filtered out.
  // Ordered by |drift_pp| descending.
  "drift": [
    {
      "asset_class": "TESOURO",
      "current_brl": 16635.25,
      "current_pct": 0.5313,
      "target_pct": 0.40,
      "target_brl": 12524.35,
      "drift_pp": 13.13,                            // signed: + = overweight
      "status": "overweight",                       // ok | overweight | underweight
      "action": {                                   // null if status="ok"
        "side": "SELL",                             // SELL | BUY
        "amount_brl": 4110.90                       // always positive
      }
    },
    {
      "asset_class": "ETF",
      "current_brl": 0,
      "current_pct": 0,
      "target_pct": 0.05,
      "target_brl": 1565.54,
      "drift_pp": -5.00,
      "status": "underweight",
      "action": { "side": "BUY", "amount_brl": 1565.54 }
    }
  ],

  "rebalance_net_brl": 0.00,                        // sum(SELL) - sum(BUY); sanity check
  "warnings": []                                     // e.g., positions skipped
}
```

**Output rules:**

- `drift_pp` is always signed: positive = overweight, negative = underweight. Claude doesn't have to infer direction.
- `status` (treat `tolerance_pp` absent as `0`, so the rules are symmetric and `drift_pp == 0` is covered):
  - `"ok"` when `|drift_pp| <= tolerance_pp` (always true when both are 0 → a perfectly-balanced class is `"ok"`)
  - `"overweight"` when `drift_pp > tolerance_pp`
  - `"underweight"` when `drift_pp < -tolerance_pp`
- `action.amount_brl` always positive; `side` carries direction. More natural for LLMs to consume.
- `rebalance_net_brl ≈ 0` is a self-consistency check. Non-zero values (beyond floating-point noise) signal a math bug and are surfaced in `warnings`.

## 8. Architecture

```text
src/
├── parsers/
│   └── allocation-target.ts        # NEW — I/O + validation
│       ├── loadAllocationTarget(path?: string): AllocationTarget
│       └── AllocationTarget = {
│             target_allocation: Partial<Record<AssetClass, number>>;
│             tolerance_pp: number | null;
│             source_path: string;
│           }
│
├── services/
│   └── drift.ts                    # NEW — pure function, zero I/O
│       └── computeDrift(
│             positions: PositionRow[],
│             target: AllocationTarget
│           ): DriftReport
│
├── tools/
│   └── calculate-allocation-drift.ts  # NEW — thin orchestration
│       └── handler:
│             positions = listPositions()
│             target    = loadAllocationTarget(input.target_path)
│             report    = computeDrift(positions, target)
│             return    { content: [{ type: "text", text: JSON.stringify(report) }] }
│
└── index.ts                        # MODIFIED — register new tool in TOOLS map
```

**Module responsibilities:**

- **`parsers/allocation-target.ts`** owns every byte of `fs.readFileSync`, every `~` expansion, every zod validation of the target file. If the rules in §5 change, only this file changes.
- **`services/drift.ts`** receives typed arrays and objects, returns a typed object. No `fs`, no `db`, no `process.env`. This is the file tests cover at 100%.
- **`tools/calculate-allocation-drift.ts`** is the MCP boundary: declares the tool's zod schema, calls the repo + parser + service, formats the JSON-RPC response. Should be ~25 lines.

**Reuses existing code:**

- `positions-repo.listPositions()` already returns `PositionRow` with `market_value_cents`. No new SQL.
- `AssetClass` enum from `storage/schema.ts` is the single source of truth for valid keys.
- `zodToJsonSchema` utility from `util/` for the MCP tool descriptor.

**No schema migration.** Target lives in a file, not in SQLite. Keeps the DB focused on imported data; configuration stays in config.

## 9. Error handling

| Scenario | Behavior |
|---|---|
| `allocation.json` missing at default path | Throw with helpful message including a minimal example to copy-paste |
| `target_path` argument points to a missing file | Throw with the explicit path (user-provided, no suggestion needed) |
| JSON syntax error | Re-throw with line/column from native parser |
| Unknown key in `target_allocation` | Throw listing valid `AssetClass` values |
| Sum outside `[0.999, 1.001]` | Throw reporting the actual sum |
| Out-of-range value (negative or > 1) | Zod error with field path |
| Negative `tolerance_pp` | Zod error |
| DB has zero positions | Return valid response with `drift: []`, `total_brl: 0`, and a `warnings` entry suggesting `import_*` tools |
| Position with `market_value_cents = null` | Skip from calculation, add to `warnings` with count |

**Principle:** parse/validation errors are **thrown** → the MCP SDK converts them to JSON-RPC `error` responses. Operational situations (empty DB, skipped positions) become **warnings in the success response** → Claude can explain them to the user and suggest the next action.

## 10. Testing strategy

Framework: `node --test` + `tsx` (already configured in `package.json`'s `test` script). Zero new dependencies.

```text
src/services/drift.test.ts
  ✓ empty positions array → drift=[], total=0, no warnings
  ✓ single class, drift=0, no tolerance_pp → status="ok", action=null (tolerance treated as 0; |0| ≤ 0)
  ✓ overweight class with tolerance band → status="overweight", action SELL with exact amount
  ✓ underweight class → status="underweight", action BUY with exact amount
  ✓ class in target but absent from positions → BUY of target_brl
  ✓ class in positions but absent from target → SELL of full current_brl
  ✓ class with current=0 AND target=0 → filtered from output
  ✓ tolerance_pp set, drift within band → status="ok", action=null
  ✓ tolerance_pp set, drift just outside band → action present
  ✓ rebalance_net_brl ≈ 0 across a multi-class fixture
  ✓ ordering: rows sorted by |drift_pp| descending

src/parsers/allocation-target.test.ts
  ✓ full valid JSON → typed object with correct shape
  ✓ JSON without tolerance_pp → tolerance_pp = null on result
  ✓ unknown key "AÇÃO" → throws with the valid-classes list
  ✓ sum = 0.95 → throws reporting actual sum
  ✓ sum = 1.0009 → passes (inside ±0.001)
  ✓ negative tolerance_pp → zod error
  ✓ missing file at default path → throws with example
  ✓ missing file at explicit target_path → throws without example
  ✓ invalid JSON syntax → throws with line/column
```

**Coverage target:** 100% of `services/drift.ts` (it's pure; no excuse) and `parsers/allocation-target.ts`. The tool itself is exercised by the existing CI smoke test once it registers a third name.

**Fixtures:** inline `const` literals in the test files. Per-file fixture directories (`tests/fixtures/`) land in v0.4.

## 11. Risks and open questions

| Risk | Mitigation |
|---|---|
| Rounding errors propagate from cents → fraction → percentage → BRL | All money math stays in cents; convert to BRL/percent only for output. Compare BRL with epsilon = 1 cent. |
| User edits `allocation.json` while Claude is mid-conversation | Acceptable: each tool call re-reads. No caching. |
| Stale `market_value_cents` because no price fetching | Acknowledged in `reference_date` field; out of scope for v0.2. Future price-fetching (roadmap) is opt-in. |
| Target sum drift due to JSON edits (e.g., 0.40 → 0.45 but forgot to adjust another class) | Strict sum validation catches this on every tool call. |

**No open questions.** All four brainstorming decisions resolved; implementation can begin.

## 12. Out of scope (YAGNI — explicitly deferred)

- Multiple named targets and switching between them
- Per-issuer or per-ticker concentration limits
- FGC limit warnings (`R$ 250k per CPF per issuer`) — separate tool, future spec
- Currency conversion (USD positions, Avenue)
- Time-series tracking of drift (snapshot per import)
- Auto-rebalancing trade suggestions optimized for IR/corretagem
- Web UI / dashboard

## 13. Definition of done

- [ ] `parsers/allocation-target.ts` and tests passing
- [ ] `services/drift.ts` and tests passing (100% coverage)
- [ ] `tools/calculate-allocation-drift.ts` registered in `index.ts`
- [ ] Tool listed by `tools/list` JSON-RPC smoke test in CI
- [ ] README updated: tool row moves from ⏳ to ✅, example added to *Demo* section
- [ ] Example `allocation.example.json` committed under `examples/`
- [ ] CI green on Node 20 + 22
- [ ] New release: `v0.2.0` with notes
