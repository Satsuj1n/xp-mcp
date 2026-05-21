import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setAdvisorProfile } from "./set-advisor-profile.js";
import { loadProfile } from "../advisor/profile.js";
import {
  DisclaimerRequiredError,
  ProfileInvalidError,
} from "../advisor/errors.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "xp-mcp-set-profile-"));
  process.env.XP_MCP_PROFILE_PATH = join(tempDir, "advisor-profile.json");
});

afterEach(() => {
  delete process.env.XP_MCP_PROFILE_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

test("saves a minimal valid profile and returns canonical defaults", async () => {
  const result = await setAdvisorProfile({
    profile: {
      risk_tolerance: 6,
      horizon_years: 10,
      objective: "balanced",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.profile.outbound_enabled, false);
  assert.deepEqual(result.profile.excluded_classes, []);
  const loaded = await loadProfile();
  assert.equal(loaded?.risk_tolerance, 6);
});

test("throws ProfileInvalidError for bad input", async () => {
  await assert.rejects(
    setAdvisorProfile({
      profile: {
        risk_tolerance: 99,
        horizon_years: 10,
        objective: "balanced",
      } as never,
    }),
    (e: unknown) => e instanceof ProfileInvalidError,
  );
});

test("outbound_enabled=true without accept_disclaimer throws DisclaimerRequiredError", async () => {
  await assert.rejects(
    setAdvisorProfile({
      profile: {
        risk_tolerance: 5,
        horizon_years: 10,
        objective: "balanced",
        outbound_enabled: true,
      },
    }),
    (e: unknown) => e instanceof DisclaimerRequiredError,
  );
});

test("outbound_enabled=true + accept_disclaimer=true stamps accepted_disclaimer_at", async () => {
  const before = Date.now();
  const result = await setAdvisorProfile({
    profile: {
      risk_tolerance: 5,
      horizon_years: 10,
      objective: "balanced",
      outbound_enabled: true,
    },
    accept_disclaimer: true,
  });
  assert.equal(result.ok, true);
  assert.ok(result.profile.accepted_disclaimer_at);
  const stamped = new Date(result.profile.accepted_disclaimer_at!).getTime();
  assert.ok(stamped >= before - 1000 && stamped <= Date.now() + 1000);
});

test("warning emitted when outbound_enabled transitions false→true", async () => {
  await setAdvisorProfile({
    profile: { risk_tolerance: 5, horizon_years: 10, objective: "balanced" },
  });
  const result = await setAdvisorProfile({
    profile: {
      risk_tolerance: 5,
      horizon_years: 10,
      objective: "balanced",
      outbound_enabled: true,
    },
    accept_disclaimer: true,
  });
  assert.ok(
    result.warnings.some((w) => w.includes("outbound_enabled")),
    `expected outbound_enabled warning, got: ${JSON.stringify(result.warnings)}`,
  );
});
