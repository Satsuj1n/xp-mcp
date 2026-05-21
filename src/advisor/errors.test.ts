import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AdvisorError,
  BrapiRateLimitError,
  BrapiTimeoutError,
  DisclaimerRequiredError,
  OutboundDisabledError,
  ProfileInvalidError,
  ProfileMissingError,
  TickerNotFoundError,
} from "./errors.js";

test("OutboundDisabledError has code OUTBOUND_DISABLED and is not recoverable", () => {
  const err = new OutboundDisabledError("nope");
  assert.equal(err.code, "OUTBOUND_DISABLED");
  assert.equal(err.recoverable, false);
  assert.ok(err instanceof AdvisorError);
});

test("ProfileMissingError has code PROFILE_MISSING", () => {
  const err = new ProfileMissingError("not found");
  assert.equal(err.code, "PROFILE_MISSING");
});

test("ProfileInvalidError carries zodErrors", () => {
  const err = new ProfileInvalidError("bad", [
    { code: "custom", message: "x", path: ["risk_tolerance"] } as never,
  ]);
  assert.equal(err.code, "PROFILE_INVALID");
  assert.equal(err.zodErrors.length, 1);
});

test("DisclaimerRequiredError has code DISCLAIMER_REQUIRED", () => {
  const err = new DisclaimerRequiredError("accept_disclaimer required");
  assert.equal(err.code, "DISCLAIMER_REQUIRED");
});

test("BrapiRateLimitError carries retryAfterSeconds and is recoverable", () => {
  const err = new BrapiRateLimitError("rate limited", 30);
  assert.equal(err.code, "BRAPI_RATE_LIMIT");
  assert.equal(err.recoverable, true);
  assert.equal(err.retryAfterSeconds, 30);
});

test("BrapiTimeoutError is recoverable", () => {
  const err = new BrapiTimeoutError("timeout");
  assert.equal(err.code, "BRAPI_TIMEOUT");
  assert.equal(err.recoverable, true);
});

test("TickerNotFoundError carries ticker", () => {
  const err = new TickerNotFoundError("XXXX99");
  assert.equal(err.code, "TICKER_NOT_FOUND");
  assert.equal(err.ticker, "XXXX99");
  assert.match(err.message, /XXXX99/);
});
