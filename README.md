<div align="center">

# portfolio-mcp

**Talk to your XP Investimentos portfolio through Claude — 100% local, read-only, zero scraping.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-FF6B6B)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/portfolio-mcp)](https://www.npmjs.com/package/portfolio-mcp)
[![Status](https://img.shields.io/badge/status-MVP-yellow)](#roadmap)

</div>

---

## What is this?

`portfolio-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes your **XP Investimentos** portfolio to Claude Desktop (or any MCP-compatible client). You feed it the official PDF/CSV exports XP already gives you — the server parses them, normalizes everything into a local SQLite database, and answers questions through MCP tools.

- 🔒 **Local-first** — data lives in `~/.xp-mcp/data.db`. Core tools make zero outbound HTTP calls; advisor tools (v0.4+) are opt-in.
- 📵 **No credentials, no scraping** — you control what goes in (PDF/CSV exports).
- 👁 **Read-only by design** — no tool can place orders or modify anything at XP.
- 🧱 **Stdio transport** — Claude spawns the process; nothing listens on a port.

> Built for personal use, but the architecture works for any custodian that lets you export reports (Rico, NuInvest, Inter, Avenue, ...). PRs welcome.

---

## Why does this exist?

Custodian apps are great at *"show me what I have"* but terrible at:

- *"Compare my current allocation against my target portfolio."*
- *"Which of my CDBs mature in the next 12 months?"*
- *"What's my real yield-to-maturity weighted by position size?"*
- *"How concentrated am I in a single issuer's FGC limit?"*

MCP lets you bolt that intelligence onto Claude **without** giving the LLM provider your credentials, sending your positions to a third-party SaaS, or trusting browser-scraping that breaks every quarter.

---

## Demo

After connecting the server, just chat with Claude:

```text
You: Liste minhas posições agrupadas por classe de ativo.

Claude (using portfolio-mcp.get_positions):
  TESOURO (53.28%)        R$ 16,644.31
    • Tesouro Selic 2031  R$ 14,556.80
    • Tesouro Selic 2028  R$  2,087.51

  RENDA_FIXA_PRIVADA (20.98%)  R$  6,554.32
    • CDB BANCO XP - AGO/2026 - 15,00%       R$ 2,203.85
    • CDB BANCO XP - SET/2026 - 14,95%       R$ 2,197.10
    • CDB BANCO XP - OUT/2026 - 14,55%       R$ 1,083.63
    • CDB BANCO XP - NOV/2027 - 100,00% CDI  R$ 1,069.74

  FUNDO  (10.48%)  R$  3,273.71
  ACAO   ( 7.44%)  R$  2,325.12  (BBAS3)
  FII    ( 7.81%)  R$  2,439.20  (MXRF11, GTWR11)

  Total: R$ 31,236.66

You: Quais CDBs vencem em 2026?

Claude (filters by asset_class + maturity_date):
  3 CDBs maturing in 2026:
    • Aug/2026 — 15.00% pre-fixed     R$ 2,203.85
    • Sep/2026 — 14.95% pre-fixed     R$ 2,197.10
    • Oct/2026 — 14.55% pre-fixed     R$ 1,083.63
  All issued by BANCO XP S.A. (within single-issuer FGC limit ✓)

You: Estou bem alocado em relação ao meu target?

Claude (using portfolio-mcp.calculate_allocation_drift):
  Lendo ~/.xp-mcp/allocation.json (target: 40% Tesouro, 20% RF, 15% FII,
  15% Ações, 5% ETF, 5% Fundos, tolerância ±2pp).

  Mais fora do alvo:
    • TESOURO:  53.28%  (target 40%)  → vender ~R$ 4.148
    • ACAO:      7.44%  (target 15%)  → comprar ~R$ 2.362
    • FII:       7.81%  (target 15%)  → comprar ~R$ 2.247

  Dentro da banda:
    • RENDA_FIXA_PRIVADA: 20.98% (target 20%) ✓

  Fora da banda, magnitude menor:
    • FUNDO: 10.48% (target  5%) — vender ~R$ 1.712
    • ETF:    0.00% (target  5%) — comprar ~R$ 1.562

  Net rebalance: -R$ 152 (aporte pequeno sugerido pra fechar).

You: Me dá um panorama do meu portfólio.

Claude (using portfolio-mcp.get_portfolio_summary):
  Total: R$ 31.236,66 (12 posições, ref. 2026-05-21)
  P&L: +R$ 2.736,66 (+9,60% sobre R$ 28.500 investidos · 8/12 com P&L computável)

  Por classe:
    TESOURO              53,28%  R$ 16.644,31
    RENDA_FIXA_PRIVADA   20,98%  R$  6.554,32  (+4,04%)
    FUNDO                10,48%  R$  3.273,71
    ACAO                  7,44%  R$  2.325,12
    FII                   7,81%  R$  2.439,20

  FGC: R$ 6.554,32 (20,98%) cobertos
  Vencimentos: curto R$ 5.484 · médio R$ 16.625 · longo R$ 1.070 · sem maturity R$ 8.038

  Reconciliação: declarado R$ 31.250,00 vs computado R$ 31.236,66
    → gap −R$ 13,34 (−0,04%, dentro de tolerância)
```

---

## Architecture

```text
┌─────────────────┐
│  Claude Desktop │
└────────┬────────┘
         │ stdio (JSON-RPC 2.0)
         ▼
┌─────────────────────┐       PDF / CSV       ┌──────────────────────┐
│   portfolio-mcp     │◀──────────────────────│   XP exports         │
│  TypeScript + MCP   │                       │   (your machine)     │
└────────┬────────────┘                       └──────────────────────┘
         │ SQL (better-sqlite3, WAL mode)
         ▼
┌─────────────────────┐
│      SQLite         │
│   ~/.xp-mcp/        │
└─────────────────────┘

      No network. No credentials. Read-only at XP.
```

**Stack:** TypeScript · [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) · `better-sqlite3` · `pdf-parse` · `papaparse` · `zod`

---

## Tools

| Tool                          | Purpose                                                                                | Status |
| ----------------------------- | -------------------------------------------------------------------------------------- | :----: |
| `import_xperformance_pdf`     | Parse XP's official portfolio PDF (XPerformance). Idempotent on re-import.             |   ✅   |
| `import_extract_csv`          | Parse a Posição Consolidada / Extrato CSV. Auto-detects delimiter and column aliases.  |   ✅   |
| `get_positions`               | List positions with quantity, market value, indexer, maturity. Optional class filter.  |   ✅   |
| `get_portfolio_summary`       | Aggregate stats + declared-vs-computed reconciliation gap. Output now includes a `cash_flow_summary` block (YTD + rolling 12m aporte/resgate aggregates) when cash flows have been imported. |   ✅   |
| `get_transactions`            | History of buys/sells                                                                  |   ⏳   |
| `get_dividends`               | Income / proventos                                                                     |   ⏳   |
| `calculate_allocation_drift`  | Compare current vs target allocation from `~/.xp-mcp/allocation.json`. Returns drift %, BRL delta, and BUY/SELL suggestions per class. |   ✅   |
| `set_advisor_profile`         | Save the advisor profile (risk, horizon, objective, exclusions, outbound gate, brapi token). |   ✅   |
| `get_advisor_profile`         | Read the saved profile. Returns `exists: false` if not configured.                     |   ✅   |
| `get_market_data`             | Quotes / fundamentals from brapi.dev for 1-50 tickers, SQLite-cached. Opt-in.          |   ✅   |
| `screen_assets`               | Rank B3 FIIs / stocks / ETFs by DY, P/VP, P/L, ROE, market cap. Opt-in.                |   ✅   |
| `import_nota_corretagem`      | Parse broker-note PDFs for transaction history                                         |   ⏳   |
| `import_bank_extract_pdf`     | Import a PDF exported from XP's Conta Digital Extrato. Filters for investment-account transfers only (APORTE/RESGATE). Idempotent. |   ✅   |
| `get_cash_flows`              | List cash flows with optional date/kind filters; returns aggregate totals (aporte/resgate/net) over all matching rows. |   ✅   |
| `suggest_buys`                | Suggest BUYs per underweight class using profile objective × asset class matrix (FII/ACAO/ETF). Non-screenable classes (TESOURO/RF/FUNDO) reported in `skipped_classes`. Requires `outbound_enabled=true`. |   ✅   |
| `calculate_twr`               | Time-weighted return (TWR) over XPerformance imports. Modified Dietz chained — GIPS-compliant for portfolios without daily NAV. Requires ≥ 2 imports. |   ✅   |
| `calculate_mwr`               | Money-weighted return (MWR / IRR) via bisection over signed cash flows. Reports converged=false cleanly when no sign change. Requires ≥ 2 imports.   |   ✅   |
| `get_crypto_quote`            | Spot crypto quotes in BRL via Mercado Bitcoin. Per-ticker partial failure, 15-min cache, outbound-gated. Quote-only (not yet a tracked asset_class). |   ✅   |

---

## Quick Start

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "portfolio": {
      "command": "npx",
      "args": ["-y", "portfolio-mcp"]
    }
  }
}
```

Config file location:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

Restart Claude Desktop. Done.

See [Development](#development) below for clone + build instructions if you want to hack on the server.

---

## How to export from XP

XP has no single *"export everything"* button. Try in this order:

1. **XPerformance PDF** *(recommended)* — Investimentos → XPerformance → ⬇ PDF. The richest single-file snapshot.
2. **Portal XP web** — Investimentos → Posição Consolidada → Exportar CSV
3. **Hub XP / Assessor Digital** — Meus Investimentos → Posição → Exportar
4. **Notas de corretagem (PDF)** — Conta → Documentos → Notas de Corretagem *(phase 2)*
5. **Extrato de movimentação** — Conta → Extrato → filtrar período → Exportar

The CSV parser auto-detects `;`, `,`, `\t`, `|` delimiters and fuzzy-matches common XP column names (`Quantidade`, `Qtd`, `Preço médio`, `Valor aplicado`, ...). If a column is missed, extend `HEADER_ALIASES` in `src/parsers/csv-extract.ts`.

### Configuring your target allocation

`calculate_allocation_drift` reads `~/.xp-mcp/allocation.json`. A starter file is included at [`examples/allocation.example.json`](./examples/allocation.example.json). Copy it once and edit the percentages:

```bash
mkdir -p ~/.xp-mcp
cp examples/allocation.example.json ~/.xp-mcp/allocation.json
```

The six valid keys are `TESOURO`, `RENDA_FIXA_PRIVADA`, `FII`, `ETF`, `ACAO`, `FUNDO`. Values must sum to `1.00` (±0.001). `tolerance_pp` is optional — when set, drifts within the band are reported as `"ok"` with no action.

---

## Try it without Claude

The server speaks JSON-RPC 2.0 over stdio. Smoke test from any terminal:

```bash
node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

You should see the server announce itself and list the registered tools.

---

## Advisor (opt-in)

v0.4 adds four MCP tools that turn `portfolio-mcp` into an investment-analysis advisor. These tools are **opt-in**: they only make outbound HTTP calls when the user has set `outbound_enabled: true` in their profile and accepted the disclaimer.

### Configure your profile

The profile lives at `~/.xp-mcp/advisor-profile.json`. Create or update it with `set_advisor_profile`:

```jsonc
{
  "risk_tolerance": 6,
  "horizon_years": 15,
  "objective": "balanced",
  "monthly_income_target_brl": 3000,
  "excluded_classes": ["FUNDO"],
  "excluded_tickers": ["XYZW3"],
  "notes": "evitar tabaco, prefiro logística e shoppings",
  "outbound_enabled": true,
  "brapi_token": "..."
}
```

When you flip `outbound_enabled` to `true`, the tool requires `accept_disclaimer: true` in the same call and stamps `accepted_disclaimer_at` on the saved profile.

### Disclaimer

> **Análise educacional baseada em dados públicos. Não constitui recomendação de investimento. Decisões financeiras são de sua responsabilidade.**

The disclaimer is also returned in `warnings[0]` of every advisor tool that ranks or suggests assets.

### Source: brapi.dev

v0.4 uses [brapi.dev](https://brapi.dev) as the sole market-data source. Anonymous calls work for personal use; if you hit rate limits, set `brapi_token` in the profile. Quotes are cached for 60 minutes, fundamentals for 24 hours, universe lists for 7 days. Override per call via `cache_ttl_minutes`.

### Example flow

1. `set_advisor_profile` — saves the profile, enables outbound
2. `get_market_data { tickers: ["BBAS3","MXRF11"] }` — quotes
3. `screen_assets { asset_class: "FII", criteria: { sort_by: "dividend_yield", order: "desc", filters: { min_dividend_yield_pct: 8 }, limit: 10 } }`

---

## Project layout

```text
src/
├── index.ts                       # MCP server entrypoint (stdio transport)
├── tools/
│   ├── import-xperformance-pdf.ts # XPerformance PDF → positions
│   ├── import-extract-csv.ts      # XP CSV → positions
│   └── get-positions.ts           # SQL → positions list with P&L
├── parsers/
│   ├── pdf-xperformance.ts        # PDF text → rows
│   ├── csv-extract.ts             # papaparse + fuzzy header matching
│   ├── classify.ts                # asset-class heuristics + name metadata
│   └── normalize.ts               # BRL / date / quantity normalizers
├── storage/
│   ├── db.ts                      # better-sqlite3 singleton, WAL, env override
│   ├── schema.ts                  # CREATE TABLE + AssetClass enum
│   └── positions-repo.ts          # UPSERT, listPositions, import records
└── util/
    └── zod-to-json-schema.ts      # minimal zod → JSON Schema for MCP
```

---

## Data model

```text
imports        every parse attempt with row counts, timestamps, source path
positions      one row per (asset_class, external_id); upserted on re-import
transactions   buys/sells from broker notes (phase 2)
dividends      income / proventos (phase 2)
```

All monetary values are stored as **`INTEGER` cents**. Float math + currency is a well-known source of off-by-a-cent bugs; integers make every aggregation exact.

The `UNIQUE (asset_class, external_id)` constraint + `ON CONFLICT DO UPDATE` makes **re-importing the same file idempotent** — no duplicates, no manual deduping.

---

## Design decisions worth calling out

- **Wide `positions` table with nullable per-class columns.** A table-per-asset-class would be cleaner in theory but adds JOINs for every read, and the column set is small. The wide table fits the access pattern (Claude almost always wants "all positions, maybe filtered by class").
- **Stdio over HTTP.** Claude Desktop spawns the process directly. Zero ports listening, no auth surface, no CORS to misconfigure. Trade-off: no remote clients without a wrapper.
- **stderr-only logging.** stdout is the JSON-RPC wire. One stray `console.log` silently corrupts every response. All logs go to stderr, where Claude Desktop captures them into `~/Library/Logs/Claude/mcp-server-xp.log`.
- **No price fetching in MVP.** Adding it means a network dependency and a rate-limit problem. When it lands (phase 2), it'll be behind an opt-in env var with a clearly-documented data source.

---

## Privacy

- The SQLite file (`~/.xp-mcp/data.db`) is the only place your position data lives. `.gitignore` blocks `*.db`, `*.sqlite`, and `data/` from ever being committed.
- The server makes **no outbound HTTP calls** for the core import/inspection tools (`import_xperformance_pdf`, `import_extract_csv`, `get_positions`, `calculate_allocation_drift`). No telemetry. No analytics.
- The v0.4 advisor tools (`get_market_data`, `screen_assets`) call brapi.dev **only when `outbound_enabled: true`** in `~/.xp-mcp/advisor-profile.json` and the user has accepted the disclaimer. Disabled by default.

---

## Roadmap

- [x] PDF parser for XPerformance (XP's official portfolio report)
- [x] CSV parser for Posição Consolidada / Extrato
- [x] `get_positions` with class filter, P&L when invested-value is known
- [ ] `import_nota_corretagem` (broker-note PDF → transactions)
- [ ] CSV parser for proventos export
- [x] `calculate_allocation_drift` against `~/.xp-mcp/allocation.json`
- [x] v0.3 — npm publish + Smithery + awesome-mcp PR
- [x] v0.4 — Investment advisor foundations: `set_advisor_profile`, `get_advisor_profile`, `get_market_data`, `screen_assets` (brapi.dev, SQLite cache)
- [x] v0.5 — Portfolio summary + reconciliation gap: `get_portfolio_summary` (aggregate stats, declared-vs-computed gap)
- [x] v0.6 — Bank extract import + cash flows: `import_bank_extract_pdf` (XP Conta Digital Extrato → `cash_flows` table, schema v3), `get_cash_flows` (filterable query with aggregate totals)
- [x] v0.7 — Suggest Buys: `suggest_buys` (composes profile + drift + screening into deterministic BUY suggestions per underweight class; non-screenable classes surface in `skipped_classes`)
- [x] v0.8 — `cash_flow_summary` in `get_portfolio_summary`: YTD + rolling 12m aporte/resgate aggregates in the panorama output (no new tool, additive field).
- [x] v0.9 — `calculate_twr` + `calculate_mwr`: time-weighted and money-weighted returns over XPerformance imports + cash_flows (Modified Dietz chained + bisection IRR; no schema change; tools MCP 12 → 14).
- [x] v0.10 — `get_crypto_quote`: spot crypto quotes in BRL via Mercado Bitcoin (`CryptoQuoteSource` interface + `MercadoBitcoinSource` impl; per-ticker partial failure; 15-min cache; outbound-gated; quote-only; tools MCP 14 → 15).
- [ ] Crypto adapter — new `MarketDataSource` for Binance / Mercado Bitcoin / Foxbit
- [ ] Adapters for other Brazilian brokers (Rico, NuInvest, Inter, Avenue)
- [ ] Open Finance Brasil investment module when the standard matures

---

## Changelog

### v0.10.0 — get_crypto_quote (2026-05-24)

- New tool `get_crypto_quote`: spot crypto quotes in BRL via Mercado
  Bitcoin's public ticker API. 1-20 symbols per call, per-ticker
  partial failure, 15-minute cache, outbound-gated.
- New `CryptoQuoteSource` interface + `MercadoBitcoinSource` impl —
  slim interface (no equity fundamentals/universe), leaves the door
  open for Binance/Foxbit later.
- `MarketDataCache.put` gains an optional `source` param (default
  brapi.dev — no behaviour change).
- Crypto is NOT yet a tracked asset_class — quote-only foundation.
  Scope B (positions, schema migration, summary/drift integration)
  deferred to a future TODO.
- Tools MCP: 14 → 15.

### v0.9.0 — calculate_twr + calculate_mwr (2026-05-24)

- New tool `calculate_twr`: time-weighted return (Modified Dietz between consecutive XPerformance snapshots, geometric chain across sub-periods). GIPS-compliant for portfolios without daily NAV.
- New tool `calculate_mwr`: money-weighted return (IRR via bisection on signed cash flows + synthetic initial/terminal NAV). Reports `converged: false` cleanly when no sign change in `[-99%, 1000%]`.
- New repo function `listValuationSnapshots` reads XPerformance imports as the NAV history — no schema change.
- New pure service `services/returns.ts` with hand-computable test references (CFA Modified Dietz example + 1Y 10% MWR case).
- Quality warnings: sparse history, large cash flows, tiny period, MWR non-convergence, stale tail.
- Tools MCP: 12 → 14.

### v0.8.0 — cash_flow_summary in get_portfolio_summary (2026-05-24)

- Additive field on `get_portfolio_summary`: `cash_flow_summary` block with YTD + rolling 12-month aporte/resgate aggregates.
- New repo function `listCashFlowsSince` (unbounded date-bounded query) in `src/storage/cash-flows-repo.ts`.
- New pure service `computeCashFlowSummary` in `src/services/cash-flow-summary.ts` — YTD + rolling 12m aggregates over `CashFlowRow[]`, no DB access. Averages divide by `months_with_data` (not 12) so short histories are not penalised.
- `get_portfolio_summary` warns when no cash flows have been imported yet (`cash_flow_summary: null`).
- 12 tools total (unchanged). No schema migration. No new MCP tool — additive field on existing tool.

### v0.7.0 — Suggest Buys (2026-05-23)

- New tool: `suggest_buys` — composes advisor profile + allocation drift + asset screening into a deterministic list of BUY suggestions per underweight asset class.
- Encodes a fixed `objective × asset_class` screening matrix (`income`/`growth`/`balanced` × `FII`/`ACAO`/`ETF`).
- Non-screenable underweight classes (`TESOURO`, `RENDA_FIXA_PRIVADA`, `FUNDO`) surface in a dedicated `skipped_classes` field rather than being silently dropped.
- Each suggestion includes `amount_brl` (= class gap / actual_returned), `score`, `rationale`, and `already_owned`.
- 12 tools total (was 11). No schema migration.

---

## Development

For contributors or anyone who wants to run a local checkout instead of the published npm package:

```bash
git clone https://github.com/Satsuj1n/portfolio-mcp
cd portfolio-mcp
npm install
npm run build
npm run test
```

Then point `claude_desktop_config.json` at the local build:

```json
{
  "mcpServers": {
    "portfolio": {
      "command": "node",
      "args": ["/absolute/path/to/portfolio-mcp/dist/index.js"]
    }
  }
}
```

Run the type checker with `npm run typecheck`. Smoke-test the MCP server end-to-end with:

```bash
node dist/index.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"local","version":"0.0.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
EOF
```

---

## Contributing

PRs welcome — especially:

- New parsers (other brokers, other export formats)
- Heuristics for `classifyAsset` covering edge cases your portfolio exposes
- Additional tools (`calculate_allocation_drift`, `get_dividends`, ...)
- Tests with anonymized fixtures (no real position values, no real account numbers)

Please **never** include real portfolio data, account numbers, or PDFs in your PR. Use the fixture pattern in `tests/fixtures/` (synthetic data only).

---

## License

MIT — see [LICENSE](./LICENSE).

Built by [Felipe Lima](https://github.com/Satsuj1n) · Powered by [Model Context Protocol](https://modelcontextprotocol.io/).
