/**
 * Shared token-bucket rate limiting + exponential-backoff retry, used by
 * every marketplace/supplier adapter that calls a real external API (hard
 * rule: "Marketplace API rate limits respected with token-bucket +
 * exponential backoff in every adapter"). Pure, clock-injectable, and has no
 * dependency on any one adapter so it's reused as-is by eBay, Amazon,
 * AliExpress, and CJ Dropshipping real implementations.
 */
export interface TokenBucketOptions {
  /** Maximum burst size. */
  capacity: number;
  refillPerSecond: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly opts: TokenBucketOptions,
    now: number = Date.now(),
  ) {
    this.tokens = opts.capacity;
    this.lastRefill = now;
  }

  private refill(now: number): void {
    const elapsedSeconds = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.opts.capacity, this.tokens + elapsedSeconds * this.opts.refillPerSecond);
    this.lastRefill = now;
  }

  /** Attempts to remove `count` tokens now; returns whether it succeeded. */
  tryRemove(count = 1, now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** How long (ms) until `count` tokens will be available. 0 if available now. */
  msUntilAvailable(count = 1, now: number = Date.now()): number {
    this.refill(now);
    if (this.tokens >= count) return 0;
    const deficit = count - this.tokens;
    return Math.ceil((deficit / this.opts.refillPerSecond) * 1000);
  }
}

export interface BackoffOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { maxRetries: 5, baseDelayMs: 250, maxDelayMs: 8000 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate-limited fetch: waits for the token bucket before every attempt, and
 * retries with jittered exponential backoff on 429 or 5xx responses. Returns
 * the first non-retryable response (2xx/3xx/4xx-other-than-429) or the final
 * response once retries are exhausted — never throws on a plain HTTP error
 * status, matching every other adapter's `fetch`-then-check-`.ok` pattern.
 */
export async function fetchWithBackoff(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  bucket: TokenBucket,
  backoff: BackoffOptions = DEFAULT_BACKOFF,
  sleepFn: (ms: number) => Promise<void> = sleep,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    const wait = bucket.msUntilAvailable();
    if (wait > 0) await sleepFn(wait);
    bucket.tryRemove();

    const res = await fetch(input, init);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= backoff.maxRetries) return res;

    const delay = Math.min(backoff.maxDelayMs, backoff.baseDelayMs * 2 ** attempt);
    const jitter = delay * (0.5 + Math.random() * 0.5);
    await sleepFn(jitter);
    attempt++;
  }
}
