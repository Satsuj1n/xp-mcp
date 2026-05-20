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
  .passthrough();

export interface AllocationTarget {
  target_allocation: Partial<Record<AssetClass, number>>;
  tolerance_pp: number | null;
  source_path: string;
}

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
