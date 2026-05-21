import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  DisclaimerRequiredError,
  OutboundDisabledError,
  ProfileInvalidError,
  ProfileMissingError,
} from "./errors.js";

export const ADVISOR_PROFILE_SCHEMA_VERSION = 1 as const;

export const assetClassEnum = z.enum([
  "TESOURO",
  "RENDA_FIXA_PRIVADA",
  "FII",
  "ETF",
  "ACAO",
  "FUNDO",
]);

export const advisorProfileSchema = z.object({
  schema_version: z
    .literal(ADVISOR_PROFILE_SCHEMA_VERSION)
    .default(ADVISOR_PROFILE_SCHEMA_VERSION),

  outbound_enabled: z.boolean().default(false),
  accepted_disclaimer_at: z.string().datetime().optional(),

  risk_tolerance: z.number().int().min(1).max(10),
  horizon_years: z.number().positive(),
  objective: z.enum(["income", "growth", "balanced"]),
  monthly_income_target_brl: z.number().nonnegative().optional(),

  excluded_classes: z.array(assetClassEnum).default([]),
  excluded_tickers: z.array(z.string().regex(/^[A-Z0-9]{4,6}$/)).default([]),

  notes: z.string().default(""),
  brapi_token: z.string().optional(),
});

export type AdvisorProfile = z.infer<typeof advisorProfileSchema>;

export function resolveProfilePath(): string {
  const override = process.env.XP_MCP_PROFILE_PATH;
  if (override) return override;
  return join(homedir(), ".xp-mcp", "advisor-profile.json");
}

export async function loadProfile(): Promise<AdvisorProfile | null> {
  const path = resolveProfilePath();
  if (!existsSync(path)) return null;

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProfileInvalidError(`Cannot read ${path}: ${msg}`, []);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ProfileInvalidError(`Invalid JSON in ${path}: ${msg}`, []);
  }

  const parsed = advisorProfileSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProfileInvalidError(
      `Invalid advisor profile at ${path}: ${parsed.error.message}`,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

export async function saveProfile(profile: AdvisorProfile): Promise<void> {
  const path = resolveProfilePath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(profile, null, 2), "utf-8");
  renameSync(tmp, path); // atomic on POSIX
}

export async function requireProfile(): Promise<AdvisorProfile> {
  const profile = await loadProfile();
  if (!profile) {
    throw new ProfileMissingError(
      `Advisor profile not found at ${resolveProfilePath()}. Call set_advisor_profile first.`,
    );
  }
  return profile;
}

export async function requireOutboundEnabled(): Promise<AdvisorProfile> {
  const profile = await requireProfile();
  if (!profile.outbound_enabled) {
    throw new OutboundDisabledError(
      "Outbound HTTP is disabled. Set outbound_enabled=true via set_advisor_profile to enable advisor features.",
    );
  }
  if (!profile.accepted_disclaimer_at) {
    throw new DisclaimerRequiredError(
      "Disclaimer not accepted. Call set_advisor_profile with accept_disclaimer=true.",
    );
  }
  return profile;
}
