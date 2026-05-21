import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAdvisorProfile } from "./get-advisor-profile.js";
import { saveProfile, advisorProfileSchema } from "../advisor/profile.js";

let tempDir: string;
let profilePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xp-mcp-get-profile-"));
  profilePath = join(tempDir, "advisor-profile.json");
  process.env.XP_MCP_PROFILE_PATH = profilePath;
});

afterEach(() => {
  delete process.env.XP_MCP_PROFILE_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

test("returns exists:false when no file", async () => {
  const result = await getAdvisorProfile({});
  assert.equal(result.exists, false);
  assert.equal(result.profile, null);
  assert.equal(result.path, profilePath);
  assert.deepEqual(result.errors, []);
});

test("returns exists:true with profile when file exists", async () => {
  await saveProfile(
    advisorProfileSchema.parse({
      risk_tolerance: 8,
      horizon_years: 20,
      objective: "growth",
    }),
  );
  const result = await getAdvisorProfile({});
  assert.equal(result.exists, true);
  assert.equal(result.profile?.risk_tolerance, 8);
  assert.deepEqual(result.errors, []);
});

test("returns exists:true with errors when file is malformed", async () => {
  writeFileSync(profilePath, "{ malformed", "utf-8");
  const result = await getAdvisorProfile({});
  assert.equal(result.exists, true);
  assert.equal(result.profile, null);
  assert.ok(result.errors.length > 0);
});
