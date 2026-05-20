<div align="center">

# xp-mcp

**Talk to your XP Investimentos portfolio through Claude — 100% local, read-only, zero scraping.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-2024--11--05-FF6B6B)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-MVP-yellow)](#roadmap)

</div>

---

## What is this?

`xp-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io/) server that exposes your **XP Investimentos** portfolio to Claude Desktop (or any MCP-compatible client). You feed it the official PDF/CSV exports XP already gives you — the server parses them, normalizes everything into a local SQLite database, and answers questions through MCP tools.

- 🔒 **Local-first** — data lives in `~/.xp-mcp/data.db`. Zero outbound HTTP calls.
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

Claude (using xp-mcp.get_positions):
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

Claude (using xp-mcp.calculate_allocation_drift):
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
│      xp-mcp         │◀──────────────────────│   XP exports         │
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
| `get_portfolio_summary`       | Aggregate stats + declared-vs-computed reconciliation gap                              |   ⏳   |
| `get_transactions`            | History of buys/sells                                                                  |   ⏳   |
| `get_dividends`               | Income / proventos                                                                     |   ⏳   |
| `calculate_allocation_drift`  | Compare current vs target allocation from `~/.xp-mcp/allocation.json`. Returns drift %, BRL delta, and BUY/SELL suggestions per class. |   ✅   |
| `import_nota_corretagem`      | Parse broker-note PDFs for transaction history                                         |   ⏳   |

---

## Quick start

Requirements: **Node.js ≥ 20**.

```bash
git clone https://github.com/Satsuj1n/xp-mcp.git
cd xp-mcp
npm install
npm run build
```

Then register the server with Claude Desktop. Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "xp": {
      "command": "node",
      "args": ["/absolute/path/to/xp-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop (Cmd+Q, not just close the window). Open a new chat — the 🔌 icon at the bottom should show `xp` connected with 3 tools.

> **Tip:** Use the absolute path to your `node` binary if Claude Desktop can't find it (`which node` in your shell). The desktop app doesn't inherit your `$PATH`.

### Custom DB path

Useful for separating dev/prod data:

```json
{
  "mcpServers": {
    "xp": {
      "command": "node",
      "args": ["/absolute/path/to/xp-mcp/dist/index.js"],
      "env": { "XP_MCP_DB_PATH": "/path/to/custom/data.db" }
    }
  }
}
```

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

You should see the server announce itself and list the three working tools.

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
- The server makes **no outbound HTTP calls** in the current MVP. No telemetry. No analytics. No price API.
- If/when price fetching is added (B3, brapi.dev, Yahoo Finance), it will be **opt-in via env var**, scoped to public quote APIs, with no portfolio data leaving the machine.

---

## Roadmap

- [x] PDF parser for XPerformance (XP's official portfolio report)
- [x] CSV parser for Posição Consolidada / Extrato
- [x] `get_positions` with class filter, P&L when invested-value is known
- [ ] `get_portfolio_summary` with declared-vs-computed reconciliation gap
- [ ] `import_nota_corretagem` (broker-note PDF → transactions)
- [ ] CSV parser for proventos export
- [x] `calculate_allocation_drift` against `~/.xp-mcp/allocation.json`
- [ ] Optional opt-in price fetching (B3 / brapi.dev / Yahoo)
- [ ] Adapters for other Brazilian brokers (Rico, NuInvest, Inter, Avenue)
- [ ] Open Finance Brasil investment module when the standard matures

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
