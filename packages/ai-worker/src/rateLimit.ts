interface Bucket {
  tokens: number;
  lastMs: number;
}

export function createRateLimiter(requestsPerMin: number) {
  const buckets = new Map<string, Bucket>();
  const refillPerMs = requestsPerMin / 60_000;

  return {
    checkRateLimit(ip: string) {
      const now = Date.now();
      let bucket = buckets.get(ip);
      if (!bucket) {
        bucket = { tokens: requestsPerMin - 1, lastMs: now };
        buckets.set(ip, bucket);
        return;
      }
      const elapsed = now - bucket.lastMs;
      bucket.tokens = Math.min(requestsPerMin, bucket.tokens + elapsed * refillPerMs);
      bucket.lastMs = now;
      if (bucket.tokens < 1) {
        throw Object.assign(
          new Error("Too many requests — please wait a moment."),
          { code: "rate_limited" },
        );
      }
      bucket.tokens -= 1;
    },
  };
}
