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
