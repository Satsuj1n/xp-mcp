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
} as const;

type ToolName = keyof typeof TOOLS;

const server = new Server(
  {
    name: "xp-mcp",
    version: "0.1.0",
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
  process.stderr.write("xp-mcp server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
  process.exit(1);
});
