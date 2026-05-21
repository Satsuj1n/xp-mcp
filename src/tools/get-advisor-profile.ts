import { existsSync } from "node:fs";
import { z } from "zod";
import { ProfileInvalidError } from "../advisor/errors.js";
import {
  loadProfile,
  resolveProfilePath,
  type AdvisorProfile,
} from "../advisor/profile.js";

export const getAdvisorProfileSchema = z
  .object({})
  .describe(
    "Read the advisor profile from disk. Returns exists:false if not yet configured. " +
      "Schema errors are returned in the errors array (not thrown), so the LLM can guide the user.",
  );

export type GetAdvisorProfileInput = z.infer<typeof getAdvisorProfileSchema>;

export interface GetAdvisorProfileResult {
  exists: boolean;
  path: string;
  profile: AdvisorProfile | null;
  errors: string[];
}

export async function getAdvisorProfile(
  _input: GetAdvisorProfileInput,
): Promise<GetAdvisorProfileResult> {
  const path = resolveProfilePath();
  if (!existsSync(path)) {
    return { exists: false, path, profile: null, errors: [] };
  }
  try {
    const profile = await loadProfile();
    return { exists: true, path, profile, errors: [] };
  } catch (e) {
    if (e instanceof ProfileInvalidError) {
      return {
        exists: true,
        path,
        profile: null,
        errors: [e.message],
      };
    }
    throw e;
  }
}
