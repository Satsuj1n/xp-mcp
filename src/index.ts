#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "./util/zod-to-json-schema.js";
import {
  importExtractCsv,
  importExtractCsvSchema,
} from "./tools/import-extract-csv.js";
import {
  importXperformancePdf,
  importXperformancePdfSchema,
} from "./tools/import-xperformance-pdf.js";
import { getPositions, getPositionsSchema } from "./tools/get-positions.js";
import {
  calculateAllocationDrift,
  calculateAllocationDriftSchema,
} from "./tools/calculate-allocation-drift.js";
import {
  setAdvisorProfile,
  setAdvisorProfileSchema,
} from "./tools/set-advisor-profile.js";
import {
  getAdvisorProfile,
  getAdvisorProfileSchema,
} from "./tools/get-advisor-profile.js";
import { getMarketData, getMarketDataSchema } from "./tools/get-market-data.js";
import { screenAssets, screenAssetsSchema } from "./tools/screen-assets.js";
import {
  getPortfolioSummary,
  getPortfolioSummarySchema,
} from "./tools/get-portfolio-summary.js";
import {
  importBankExtractPdf,
  importBankExtractPdfSchema,
} from "./tools/import-bank-extract-pdf.js";
import { getCashFlows, getCashFlowsSchema } from "./tools/get-cash-flows.js";
import { suggestBuys, suggestBuysSchema } from "./tools/suggest-buys.js";
import { calculateTwr, calculateTwrSchema } from "./tools/calculate-twr.js";
import { calculateMwr, calculateMwrSchema } from "./tools/calculate-mwr.js";
import {
  getCryptoQuote,
  getCryptoQuoteSchema,
} from "./tools/get-crypto-quote.js";
import {
  setCryptoPosition,
  setCryptoPositionSchema,
} from "./tools/set-crypto-position.js";

/**
 * Tool registry. Adding a new tool = adding one entry here.
 * Each entry owns its zod schema and its handler.
 */
const TOOLS = {
  import_xperformance_pdf: {
    description:
      "Import the XPerformance PDF (XP's official portfolio report). " +
      "Extracts patrimônio total, reference date, and per-asset position rows " +
      "(quantity, market value, %allocation, indexer, maturity). Idempotent: " +
      "re-importing the same file updates existing positions. Returns import " +
      "counts, warnings, and a preview of up to 10 positions.",
    schema: importXperformancePdfSchema,
    handler: importXperformancePdf,
  },
  import_extract_csv: {
    description:
      "Import a CSV exported from XP Investimentos (Posicao Consolidada, Extrato). " +
      "Idempotent: re-importing the same file updates existing positions instead of duplicating. " +
      "Returns counts, warnings, and a preview of the first 5 parsed positions.",
    schema: importExtractCsvSchema,
    handler: importExtractCsv,
  },
  get_positions: {
    description:
      "List all positions in the portfolio. Optional filter by asset_class. " +
      "Returns each position with quantity, avg/current price, invested vs market value, " +
      "and unrealized P&L. Values in BRL (Brazilian Reais).",
    schema: getPositionsSchema,
    handler: getPositions,
  },
  calculate_allocation_drift: {
    description:
      "Compare current portfolio allocation against a target defined in ~/.xp-mcp/allocation.json. " +
      "Returns per-class drift in percentage points and BRL, with suggested BUY/SELL actions to rebalance. " +
      "Optional 'target_path' argument overrides the default location. " +
      "Optional 'tolerance_pp' field in the JSON treats drifts within the band as 'ok' (no action).",
    schema: calculateAllocationDriftSchema,
    handler: calculateAllocationDrift,
  },
  set_advisor_profile: {
    description:
      "Save (overwrite) the advisor profile at ~/.xp-mcp/advisor-profile.json. " +
      "Required fields: risk_tolerance (1-10), horizon_years (>0), objective ('income'|'growth'|'balanced'). " +
      "Optional: outbound_enabled (default false), excluded_classes, excluded_tickers, notes, brapi_token. " +
      "Enabling outbound_enabled=true requires accept_disclaimer=true on the call.",
    schema: setAdvisorProfileSchema,
    handler: setAdvisorProfile,
  },
  get_advisor_profile: {
    description:
      "Read the advisor profile from ~/.xp-mcp/advisor-profile.json. " +
      "Returns exists:false when the file is not yet configured; reports schema errors in the errors array.",
    schema: getAdvisorProfileSchema,
    handler: getAdvisorProfile,
  },
  get_market_data: {
    description:
      "Fetch quotes and/or fundamentals from brapi.dev for 1-50 tickers, with SQLite caching. " +
      "Requires outbound_enabled=true in the advisor profile. Per-ticker partial failures are reported in results[].error " +
      "without failing the whole call. cache_ttl_minutes overrides the default TTL (60 quote / 1440 fundamentals).",
    schema: getMarketDataSchema,
    handler: getMarketData,
  },
  screen_assets: {
    description:
      "Rank B3 assets (FII | ACAO | ETF) against criteria (sort_by, filters, limit). " +
      "Fetches the universe and per-ticker quote+fundamentals from brapi.dev (cached). " +
      "Profile's excluded_classes/excluded_tickers are merged with the call's exclude_tickers. " +
      "Output is educational analysis, not investment advice.",
    schema: screenAssetsSchema,
    handler: screenAssets,
  },
  get_portfolio_summary: {
    description:
      "Aggregate stats + reconciliation gap for the portfolio. Returns total market value, " +
      "per-class breakdown (% and BRL), top 5 positions, total/per-class P&L, FGC coverage, " +
      "maturity buckets (short/medium/long), and the gap between the declared patrimônio total " +
      "(from the last XPerformance PDF) vs computed total. Zero outbound HTTP. No inputs.",
    schema: getPortfolioSummarySchema,
    handler: getPortfolioSummary,
  },
  import_bank_extract_pdf: {
    description:
      "Import a PDF exported from XP's Conta Digital Extrato (digital account statement). " +
      "Filters for transfers between digital account and investment account only " +
      "(deposits = APORTE, withdrawals = RESGATE). Idempotent: re-importing the same " +
      "file skips duplicates. Persists to the cash_flows table.",
    schema: importBankExtractPdfSchema,
    handler: importBankExtractPdf,
  },
  get_cash_flows: {
    description:
      "List cash flows (APORTE/RESGATE) with optional date range and kind filters. " +
      "Returns up to `limit` rows sorted by flow_datetime DESC, plus aggregate totals " +
      "(aporte_total, resgate_total, net) computed over ALL matching rows.",
    schema: getCashFlowsSchema,
    handler: getCashFlows,
  },
  suggest_buys: {
    description:
      "Suggest BUY actions per underweight asset class based on the advisor profile. " +
      "Composes drift + screening per class (FII/ACAO/ETF) using a fixed " +
      "objective × asset_class criteria matrix; non-screenable classes " +
      "(TESOURO/RF/FUNDO) surface in skipped_classes with reason. " +
      "Requires outbound_enabled=true. Output is educational analysis, not investment advice.",
    schema: suggestBuysSchema,
    handler: suggestBuys,
  },
  calculate_twr: {
    description:
      "Time-weighted return (TWR) over the XPerformance import history. " +
      "Removes the effect of when you contributed/withdrew — pure portfolio " +
      "performance metric, GIPS-compliant. Uses Modified Dietz between " +
      "consecutive imports and chains sub-periods geometrically. Requires " +
      "≥ 2 XPerformance imports. Returns period_return, annualized return, " +
      "per-sub-period breakdown, and quality warnings (sparse history, " +
      "large cash flows, stale tail).",
    schema: calculateTwrSchema,
    handler: calculateTwr,
  },
  calculate_mwr: {
    description:
      "Money-weighted return (MWR / IRR) — the rate that reflects when " +
      "you put money in vs. out. Computed via bisection over signed cash " +
      "flows including synthetic initial/terminal NAV. Requires ≥ 2 " +
      "XPerformance imports. Returns mwr_period, mwr_annualized, " +
      "cash_flow_breakdown, convergence diagnostics, and warnings.",
    schema: calculateMwrSchema,
    handler: calculateMwr,
  },
  get_crypto_quote: {
    description:
      "Spot crypto quotes in BRL via Mercado Bitcoin (e.g. BTC, ETH, SOL). " +
      "Per-ticker partial failure: one unknown symbol doesn't fail the " +
      "batch. 15-minute cache, outbound-gated. Quote only — crypto is not " +
      "yet a tracked portfolio asset_class.",
    schema: getCryptoQuoteSchema,
    handler: getCryptoQuote,
  },
  set_crypto_position: {
    description:
      "Manually track a crypto holding (e.g. BTC, ETH). Fetches the current " +
      "BRL quote (multi-source: Mercado Bitcoin → Foxbit → Binance) and stores " +
      "a snapshot market value (quantity × current price) as a CRIPTO position, " +
      "which then flows into get_portfolio_summary and calculate_allocation_drift. " +
      "quantity=0 removes the holding (idempotent). Re-run to refresh the value. " +
      "Outbound-gated. Snapshot only — no cost basis / P&L is recorded.",
    schema: setCryptoPositionSchema,
    handler: setCryptoPosition,
  },
} as const;

type ToolName = keyof typeof TOOLS;

const server = new Server(
  {
    name: "portfolio-mcp",
    version: "0.11.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    inputSchema: zodToJsonSchema(def.schema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name as ToolName;
  const def = TOOLS[name];
  if (!def) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }

  const parsed = def.schema.safeParse(req.params.arguments ?? {});
  if (!parsed.success) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Invalid arguments for ${name}: ${parsed.error.message}`,
        },
      ],
    };
  }

  try {
    // The handler shape is { (input): Promise<unknown> }; we narrow with `as never`
    // because TS can't prove that parsed.data fits this specific handler at the
    // dispatch site (it does at each definition site).
    const result = await def.handler(parsed.data as never);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Tool ${name} failed: ${message}` }],
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // No console.log on stdout — that channel is the MCP transport.
  // Log to stderr only.
  process.stderr.write("portfolio-mcp server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
