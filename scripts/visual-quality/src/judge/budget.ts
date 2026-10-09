// Request and spending limits for paid judging. Every attempt, including
// retries, reserves one request and an estimated cost before it is sent; the
// estimate is replaced by the reported usage when the response arrives.
//
// This is not an exact dollar cap: requests already in flight may finish after
// the limit is reached, and image token counts are estimated until the API
// reports usage.

export interface BudgetLimits {
  maxRequests: number;
  maxCostUsd: number;
  usdPerInputToken: number;
}

export interface Reservation {
  estimatedTokens: number;
  settled: boolean;
}

export class Budget {
  requests = 0;
  // Input tokens reported by the API.
  inputTokens = 0;
  // Reported cost plus estimates for requests without usage.
  costUsd = 0;
  // Requests whose cost couldn't be measured (no usage in the response).
  unmeasured = 0;
  private reservedUsd = 0;
  private exhaustedReason: string | null = null;

  constructor(readonly limits: BudgetLimits) {}

  get exhausted(): string | null {
    return this.exhaustedReason;
  }

  // Returns null (and latches exhaustion) when the next attempt would exceed a
  // limit, so no further work gets scheduled.
  reserve(estimatedTokens: number): Reservation | null {
    if (this.exhaustedReason) return null;
    if (this.requests >= this.limits.maxRequests) {
      this.exhaustedReason = `request limit reached (${this.limits.maxRequests})`;
      return null;
    }
    const estimate = estimatedTokens * this.limits.usdPerInputToken;
    if (this.costUsd + this.reservedUsd + estimate > this.limits.maxCostUsd) {
      this.exhaustedReason = `spending limit reached ($${this.limits.maxCostUsd})`;
      return null;
    }
    this.requests += 1;
    this.reservedUsd += estimate;
    return { estimatedTokens, settled: false };
  }

  settle(reservation: Reservation, inputTokens: number | null): number {
    if (reservation.settled) return 0;
    reservation.settled = true;
    this.reservedUsd -= reservation.estimatedTokens * this.limits.usdPerInputToken;
    // Without reported usage, charge the estimate so limits stay conservative.
    if (inputTokens === null) this.unmeasured += 1;
    else this.inputTokens += inputTokens;
    const cost = (inputTokens ?? reservation.estimatedTokens) * this.limits.usdPerInputToken;
    this.costUsd += cost;
    return cost;
  }
}
