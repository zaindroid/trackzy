import type { CacheClient, SupplierMatch } from './types.js';

/**
 * Real CacheClient — talks to the portal's token-authed, D1-backed cache/budget
 * endpoints (the crawler can't reach D1 directly). `ingestUrl` is the base
 * .../ingest/radar; the supplier routes hang off it.
 */
export class WorkerCacheClient implements CacheClient {
  constructor(
    private readonly ingestUrl: string,
    private readonly token: string,
  ) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.ingestUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`cache ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  lookup(keys: string[], ttlDays: number) {
    return this.post<{ hits: Record<string, { match: SupplierMatch | null }>; monthUsage: number }>('/supplier/lookup', { keys, ttlDays });
  }

  store(entries: { key: string; match: SupplierMatch | null; resultsConsumed: number }[]) {
    return this.post<{ monthUsage: number }>('/supplier/store', { entries });
  }
}
