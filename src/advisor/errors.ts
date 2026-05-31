import type { z } from "zod";

export abstract class AdvisorError extends Error {
  abstract readonly code: string;
  readonly recoverable: boolean = false;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class OutboundDisabledError extends AdvisorError {
  readonly code = "OUTBOUND_DISABLED";
}

export class ProfileMissingError extends AdvisorError {
  readonly code = "PROFILE_MISSING";
}

export class ProfileInvalidError extends AdvisorError {
  readonly code = "PROFILE_INVALID";
  constructor(
    message: string,
    public readonly zodErrors: z.ZodIssue[],
  ) {
    super(message);
  }
}

export class DisclaimerRequiredError extends AdvisorError {
  readonly code = "DISCLAIMER_REQUIRED";
}

export class UpstreamRateLimitError extends AdvisorError {
  readonly code = "UPSTREAM_RATE_LIMIT";
  override readonly recoverable = true;
  constructor(
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

export class UpstreamTimeoutError extends AdvisorError {
  readonly code = "UPSTREAM_TIMEOUT";
  override readonly recoverable = true;
}

/**
 * A non-2xx, non-429 HTTP response from an upstream API. Carries the numeric
 * `status` so callers can branch on it (e.g. map 4xx → TickerNotFoundError)
 * without parsing the human-readable message. `recoverable` stays false to
 * preserve the existing multi-source fall-through behavior.
 */
export class UpstreamHttpError extends AdvisorError {
  readonly code = "UPSTREAM_HTTP";
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export class TickerNotFoundError extends AdvisorError {
  readonly code = "TICKER_NOT_FOUND";
  constructor(public readonly ticker: string) {
    super(`Ticker not found: ${ticker}`);
  }
}
