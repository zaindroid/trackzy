import { describe, expect, it, vi } from 'vitest';
import { TokenBucket, fetchWithBackoff } from './rateLimit.js';

describe('TokenBucket', () => {
  it('allows up to capacity tokens immediately, then blocks', () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 }, 0);
    expect(bucket.tryRemove(1, 0)).toBe(true);
    expect(bucket.tryRemove(1, 0)).toBe(true);
    expect(bucket.tryRemove(1, 0)).toBe(true);
    expect(bucket.tryRemove(1, 0)).toBe(false);
  });

  it('refills proportionally to elapsed time', () => {
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1 }, 0);
    bucket.tryRemove(3, 0); // drain fully
    expect(bucket.tryRemove(1, 500)).toBe(false); // 0.5s elapsed, 0.5 tokens < 1
    expect(bucket.tryRemove(1, 1000)).toBe(true); // 1s elapsed, 1 token available
  });

  it('never refills beyond capacity', () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 100 }, 0);
    bucket.tryRemove(1, 0); // 1 token left
    // A huge amount of elapsed time would refill far more than capacity if
    // uncapped; the bucket must clamp back down to exactly `capacity`.
    expect(bucket.tryRemove(2, 100_000)).toBe(true); // exactly capacity=2 available
    expect(bucket.tryRemove(1, 100_000)).toBe(false); // nothing left beyond capacity
  });

  it('reports msUntilAvailable correctly when tokens are exhausted', () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 2 }, 0);
    bucket.tryRemove(1, 0);
    expect(bucket.msUntilAvailable(1, 0)).toBe(500); // need 1 token at 2/s = 500ms
  });

  it('reports 0 msUntilAvailable when tokens are already available', () => {
    const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 1 }, 0);
    expect(bucket.msUntilAvailable(1, 0)).toBe(0);
  });
});

describe('fetchWithBackoff', () => {
  it('returns immediately on a successful response without retrying', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 10 });
    const sleepFn = vi.fn(async () => undefined);

    const res = await fetchWithBackoff('https://example.com', undefined, bucket, undefined, sleepFn);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('retries on 429 with backoff, then succeeds', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      return call < 3 ? new Response('rate limited', { status: 429 }) : new Response('ok', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 10 });
    const sleepCalls: number[] = [];
    const sleepFn = vi.fn(async (ms: number) => {
      sleepCalls.push(ms);
    });

    const res = await fetchWithBackoff(
      'https://example.com',
      undefined,
      bucket,
      { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 1000 },
      sleepFn,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepCalls.length).toBeGreaterThanOrEqual(2); // at least the two backoff waits between retries
    vi.unstubAllGlobals();
  });

  it('gives up after maxRetries and returns the last failing response', async () => {
    const fetchMock = vi.fn(async () => new Response('server error', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 10 });
    const sleepFn = vi.fn(async () => undefined);

    const res = await fetchWithBackoff(
      'https://example.com',
      undefined,
      bucket,
      { maxRetries: 2, baseDelayMs: 5, maxDelayMs: 50 },
      sleepFn,
    );

    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial attempt + 2 retries
    vi.unstubAllGlobals();
  });

  it('does not retry on a plain 4xx (non-429) error', async () => {
    const fetchMock = vi.fn(async () => new Response('bad request', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    const bucket = new TokenBucket({ capacity: 10, refillPerSecond: 10 });
    const sleepFn = vi.fn(async () => undefined);

    const res = await fetchWithBackoff('https://example.com', undefined, bucket, undefined, sleepFn);

    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
