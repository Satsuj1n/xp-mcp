import { BrapiRateLimitError, BrapiTimeoutError } from "../errors.js";

export interface FetchWithRetryOpts {
  timeout_ms?: number;
  max_retries?: number;
  backoff_base_ms?: number;
}

function defaultTimeout(): number {
  const env = process.env.BRAPI_TIMEOUT_MS;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 5000;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const TIMED_OUT = Symbol("TIMED_OUT");

/**
 * Wraps fetch with a Promise.race timeout so the deadline fires even when
 * the underlying fetch implementation (e.g. a test mock) ignores AbortSignal.
 */
async function timedFetch(
  url: string,
  timeout: number,
): Promise<Response | typeof TIMED_OUT> {
  const timeoutP = sleep(timeout).then((): typeof TIMED_OUT => TIMED_OUT);
  const controller = new AbortController();
  const fetchP: Promise<Response | typeof TIMED_OUT> = fetch(url, {
    signal: controller.signal,
  }).then(
    (res) => res as Response | typeof TIMED_OUT,
    (err: unknown) => {
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        return TIMED_OUT;
      }
      throw err;
    },
  );
  const result = await Promise.race([fetchP, timeoutP]);
  if (result === TIMED_OUT) {
    controller.abort();
  }
  return result;
}

export async function fetchWithRetry(
  url: string,
  opts: FetchWithRetryOpts = {},
): Promise<unknown> {
  const timeout = opts.timeout_ms ?? defaultTimeout();
  const maxRetries = opts.max_retries ?? 2;
  const base = opts.backoff_base_ms ?? 1000;

  let last429: Response | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await timedFetch(url, timeout);

    if (res === TIMED_OUT) {
      if (attempt === maxRetries) {
        throw new BrapiTimeoutError(`Timeout after ${timeout}ms for ${url}`);
      }
      await sleep(base * (attempt + 1));
      continue;
    }

    if (res.status === 429) {
      last429 = res;
      if (attempt === maxRetries) break;
      await sleep(base * Math.pow(2, attempt));
      continue;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }

    return await res.json();
  }

  const retryAfter = last429?.headers.get("retry-after");
  const seconds = retryAfter
    ? Number(retryAfter)
    : (base * Math.pow(2, maxRetries)) / 1000;
  throw new BrapiRateLimitError(
    `Rate limited (429) for ${url}`,
    Number.isFinite(seconds) ? seconds : 60,
  );
}
