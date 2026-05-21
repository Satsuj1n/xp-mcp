import { z } from "zod";
import {
  DisclaimerRequiredError,
  ProfileInvalidError,
} from "../advisor/errors.js";
import {
  advisorProfileSchema,
  loadProfile,
  resolveProfilePath,
  saveProfile,
  type AdvisorProfile,
} from "../advisor/profile.js";

// Input profile is the same schema with defaults applied lazily — handler
// validates explicitly so we can wrap any failure in ProfileInvalidError.
export const setAdvisorProfileSchema = z.object({
  profile: z
    .unknown()
    .describe(
      "Full advisor profile. Required fields: risk_tolerance (1-10), horizon_years (>0), objective ('income'|'growth'|'balanced'). " +
        "Optional fields fill defaults. See get_advisor_profile output for the canonical shape.",
    ),
  accept_disclaimer: z
    .boolean()
    .optional()
    .describe(
      "Required when setting outbound_enabled=true. Stamps accepted_disclaimer_at = now (ISO). " +
        "Disclaimer text: 'Análise educacional baseada em dados públicos. Não constitui recomendação de investimento.'",
    ),
});

export type SetAdvisorProfileInput = z.infer<typeof setAdvisorProfileSchema>;

export interface SetAdvisorProfileResult {
  ok: boolean;
  path: string;
  profile: AdvisorProfile;
  warnings: string[];
}

export async function setAdvisorProfile(
  input: SetAdvisorProfileInput,
): Promise<SetAdvisorProfileResult> {
  const parsed = advisorProfileSchema.safeParse(input.profile);
  if (!parsed.success) {
    throw new ProfileInvalidError(
      `Invalid advisor profile: ${parsed.error.message}`,
      parsed.error.issues,
    );
  }
  const candidate: AdvisorProfile = parsed.data;

  if (candidate.outbound_enabled) {
    if (!input.accept_disclaimer) {
      throw new DisclaimerRequiredError(
        "outbound_enabled=true requires accept_disclaimer=true in the tool call.",
      );
    }
    if (!candidate.accepted_disclaimer_at) {
      candidate.accepted_disclaimer_at = new Date().toISOString();
    }
  }

  const prior = await loadProfile();
  const warnings: string[] = [];
  if (prior && prior.outbound_enabled !== candidate.outbound_enabled) {
    warnings.push(
      `outbound_enabled changed from ${prior.outbound_enabled} to ${candidate.outbound_enabled}`,
    );
  }

  await saveProfile(candidate);
  return {
    ok: true,
    path: resolveProfilePath(),
    profile: candidate,
    warnings,
  };
}
