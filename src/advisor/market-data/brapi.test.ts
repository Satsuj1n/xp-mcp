import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BrapiSource } from "./brapi.js";
import { TickerNotFoundError } from "../errors.js";

type FetchFn = typeof globalThis.fetch;
let originalFetch: FetchFn;
const FIX = join(process.cwd(), "tests/fixtures/brapi");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf-8"));
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("getQuote builds correct URL and parses payload", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(fixture("quote-bbas3.json"));
  }) as FetchFn;
  const source = new BrapiSource();
  const quote = await source.getQuote("BBAS3");
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://brapi.dev/api/quote/BBAS3");
  assert.equal(quote.ticker, "BBAS3");
  assert.equal(quote.price_brl, 30.42);
  assert.equal(quote.change_pct, -0.85);
  assert.equal(quote.volume, 12345678);
  assert.equal(quote.market_cap_brl, 86200000000);
  assert.equal(quote.updated_at, "2026-05-20T20:00:00.000Z");
});

test("getQuote appends token query when provided", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(fixture("quote-bbas3.json"));
  }) as FetchFn;
  const source = new BrapiSource({ token: "abc123" });
  await source.getQuote("BBAS3");
  assert.equal(calls[0], "https://brapi.dev/api/quote/BBAS3?token=abc123");
});

test("getQuote throws TickerNotFoundError on empty results", async () => {
  globalThis.fetch = (async () => jsonResponse({ results: [] })) as FetchFn;
  const source = new BrapiSource();
  await assert.rejects(
    source.getQuote("XXXX99"),
    (e: unknown) => e instanceof TickerNotFoundError,
  );
});

test("getFundamentals requests ?fundamental=true and parses extended payload", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(fixture("fundamentals-bbas3.json"));
  }) as FetchFn;
  const source = new BrapiSource();
  const f = await source.getFundamentals("BBAS3");
  assert.equal(calls[0], "https://brapi.dev/api/quote/BBAS3?fundamental=true");
  assert.equal(f.ticker, "BBAS3");
  assert.equal(f.dividend_yield_pct, 9.87);
  assert.equal(f.pl_ratio, 5.4);
  assert.equal(f.pvp_ratio, 1.05);
  assert.equal(f.roe_pct, 21);
  assert.equal(f.vacancy_pct, null);
});

test("getFundamentals captures vacancy_pct for FIIs", async () => {
  globalThis.fetch = (async () =>
    jsonResponse(fixture("fundamentals-mxrf11.json"))) as FetchFn;
  const source = new BrapiSource();
  const f = await source.getFundamentals("MXRF11");
  assert.equal(f.vacancy_pct, 4);
});

test("listUniverse('FII') hits /quote/list?type=fund and classifies items", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(fixture("universe-fii.json"));
  }) as FetchFn;
  const source = new BrapiSource();
  const universe = await source.listUniverse("FII");
  assert.equal(calls[0], "https://brapi.dev/api/quote/list?type=fund");
  assert.equal(universe.length, 3);
  assert.equal(universe[0].ticker, "MXRF11");
  assert.equal(universe[0].asset_class, "FII");
});

test("listUniverse('ACAO') hits ?type=stock", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(url);
    return jsonResponse(fixture("universe-acao.json"));
  }) as FetchFn;
  const source = new BrapiSource();
  const universe = await source.listUniverse("ACAO");
  assert.equal(calls[0], "https://brapi.dev/api/quote/list?type=stock");
  assert.equal(universe[0].asset_class, "ACAO");
});
