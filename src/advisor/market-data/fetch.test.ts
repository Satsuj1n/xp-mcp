import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchWithRetry } from "./fetch.js";
import {
  UpstreamHttpError,
  UpstreamRateLimitError,
  UpstreamTimeoutError,
} from "../errors.js";

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(responses: Array<() => Promise<Response>>): void {
  let i = 0;
  globalThis.fetch = (async () => {
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    return next();
  }) as FetchFn;
}

test("returns parsed JSON on 200", async () => {
  mockFetch([
    async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
  ]);
  const result = await fetchWithRetry("https://example/x");
  assert.deepEqual(result, { ok: 1 });
});

test("retries on 429 with exponential backoff, then succeeds", async () => {
  mockFetch([
    async () => new Response("rate limit", { status: 429 }),
    async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
  ]);
  const start = Date.now();
  const result = await fetchWithRetry("https://example/x", {
    max_retries: 2,
    backoff_base_ms: 10, // override to keep test fast
  });
  const elapsed = Date.now() - start;
  assert.deepEqual(result, { ok: 1 });
  assert.ok(elapsed >= 10, `expected backoff to wait, elapsed=${elapsed}ms`);
});

test("throws UpstreamRateLimitError when 429 persists beyond max_retries", async () => {
  mockFetch([async () => new Response("rate limit", { status: 429 })]);
  await assert.rejects(
    fetchWithRetry("https://example/x", { max_retries: 1, backoff_base_ms: 5 }),
    (e: unknown) => e instanceof UpstreamRateLimitError,
  );
});

test("throws UpstreamTimeoutError on abort", async () => {
  mockFetch([
    async () => {
      await new Promise((r) => setTimeout(r, 200));
      return new Response("late", { status: 200 });
    },
  ]);
  await assert.rejects(
    fetchWithRetry("https://example/x", { timeout_ms: 20, max_retries: 0 }),
    (e: unknown) => e instanceof UpstreamTimeoutError,
  );
});

test("throws on non-429 non-OK without retry", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("not found", { status: 404 });
  }) as FetchFn;
  await assert.rejects(
    fetchWithRetry("https://example/x", { max_retries: 3, backoff_base_ms: 5 }),
    (e: unknown) => e instanceof Error && /HTTP 404/.test(e.message),
  );
  assert.equal(calls, 1, "404 should not retry");
});

test("throws UpstreamHttpError carrying the numeric status on 4xx", async () => {
  globalThis.fetch = (async () =>
    new Response("not found", { status: 404 })) as FetchFn;
  await assert.rejects(
    fetchWithRetry("https://example/x", { max_retries: 0 }),
    (e: unknown) => e instanceof UpstreamHttpError && e.status === 404,
  );
});
