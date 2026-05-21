import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  advisorProfileSchema,
  loadProfile,
  saveProfile,
  requireProfile,
  requireOutboundEnabled,
  resolveProfilePath,
  ADVISOR_PROFILE_SCHEMA_VERSION,
} from "./profile.js";
import {
  DisclaimerRequiredError,
  OutboundDisabledError,
  ProfileInvalidError,
  ProfileMissingError,
} from "./errors.js";

let tempDir: string;
let profilePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xp-mcp-profile-"));
  profilePath = join(tempDir, "advisor-profile.json");
  process.env.XP_MCP_PROFILE_PATH = profilePath;
});

afterEach(() => {
  delete process.env.XP_MCP_PROFILE_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

test("resolveProfilePath honors XP_MCP_PROFILE_PATH", () => {
  assert.equal(resolveProfilePath(), profilePath);
});

test("schema accepts a minimal valid profile and fills defaults", () => {
  const parsed = advisorProfileSchema.parse({
    risk_tolerance: 5,
    horizon_years: 10,
    objective: "balanced",
  });
  assert.equal(parsed.schema_version, ADVISOR_PROFILE_SCHEMA_VERSION);
  assert.equal(parsed.outbound_enabled, false);
  assert.deepEqual(parsed.excluded_classes, []);
  assert.deepEqual(parsed.excluded_tickers, []);
  assert.equal(parsed.notes, "");
});

test("schema rejects risk_tolerance out of [1,10]", () => {
  const result = advisorProfileSchema.safeParse({
    risk_tolerance: 11,
    horizon_years: 10,
    objective: "balanced",
  });
  assert.equal(result.success, false);
});

test("schema rejects ticker that doesn't match regex", () => {
  const result = advisorProfileSchema.safeParse({
    risk_tolerance: 5,
    horizon_years: 10,
    objective: "balanced",
    excluded_tickers: ["lowercase"],
  });
  assert.equal(result.success, false);
});

test("loadProfile returns null when file does not exist", async () => {
  const profile = await loadProfile();
  assert.equal(profile, null);
});

test("requireProfile throws ProfileMissingError when file does not exist", async () => {
  await assert.rejects(
    requireProfile(),
    (e: unknown) => e instanceof ProfileMissingError,
  );
});

test("saveProfile writes atomically and loadProfile round-trips", async () => {
  const profile = advisorProfileSchema.parse({
    risk_tolerance: 7,
    horizon_years: 15,
    objective: "income",
    notes: "evitar tabaco",
  });
  await saveProfile(profile);
  assert.ok(existsSync(profilePath));
  // No leftover .tmp.* files
  const leftover = readFileSync(profilePath, "utf-8");
  assert.match(leftover, /"risk_tolerance": 7/);
  const loaded = await loadProfile();
  assert.deepEqual(loaded, profile);
});

test("loadProfile throws ProfileInvalidError when file is malformed JSON", async () => {
  writeFileSync(profilePath, "{ not valid json", "utf-8");
  await assert.rejects(
    loadProfile(),
    (e: unknown) => e instanceof ProfileInvalidError,
  );
});

test("loadProfile throws ProfileInvalidError when schema validation fails", async () => {
  writeFileSync(
    profilePath,
    JSON.stringify({
      risk_tolerance: 99,
      horizon_years: 10,
      objective: "balanced",
    }),
    "utf-8",
  );
  await assert.rejects(
    loadProfile(),
    (e: unknown) => e instanceof ProfileInvalidError,
  );
});

test("requireOutboundEnabled throws OutboundDisabledError when outbound_enabled=false", async () => {
  const profile = advisorProfileSchema.parse({
    risk_tolerance: 5,
    horizon_years: 10,
    objective: "balanced",
  });
  await saveProfile(profile);
  await assert.rejects(
    requireOutboundEnabled(),
    (e: unknown) => e instanceof OutboundDisabledError,
  );
});

test("requireOutboundEnabled throws DisclaimerRequiredError when outbound_enabled=true but no disclaimer", async () => {
  const profile = advisorProfileSchema.parse({
    risk_tolerance: 5,
    horizon_years: 10,
    objective: "balanced",
    outbound_enabled: true,
  });
  await saveProfile(profile);
  await assert.rejects(
    requireOutboundEnabled(),
    (e: unknown) => e instanceof DisclaimerRequiredError,
  );
});

test("requireOutboundEnabled returns profile when outbound_enabled=true and disclaimer accepted", async () => {
  const profile = advisorProfileSchema.parse({
    risk_tolerance: 5,
    horizon_years: 10,
    objective: "balanced",
    outbound_enabled: true,
    accepted_disclaimer_at: new Date().toISOString(),
  });
  await saveProfile(profile);
  const result = await requireOutboundEnabled();
  assert.equal(result.outbound_enabled, true);
});
