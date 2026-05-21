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

export class BrapiRateLimitError extends AdvisorError {
  readonly code = "BRAPI_RATE_LIMIT";
  readonly recoverable = true;
  constructor(
    message: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}

export class BrapiTimeoutError extends AdvisorError {
  readonly code = "BRAPI_TIMEOUT";
  readonly recoverable = true;
}

export class TickerNotFoundError extends AdvisorError {
  readonly code = "TICKER_NOT_FOUND";
  constructor(public readonly ticker: string) {
    super(`Ticker not found: ${ticker}`);
  }
}
