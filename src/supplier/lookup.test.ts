import { describe, expect, it, vi } from 'vitest';
import { resolveSuppliers, type SupplierDeps } from './lookup.js';
import { normalizeQuery } from './normalize.js';
import type { CacheClient, SupplierMatch, SupplierProvider } from './types.js';

const CONFIG = { topN: 30, ttlDays: 10, maxItems: 8, monthlyBudget: 1000 };

function match(id: string): SupplierMatch {
  return { productId: id, url: `https://ae/${id}`, costCents: 300 };
}

/** Provider that records how many times Apify would have been called. */
function countingProvider(): SupplierProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    source: 'test',
    calls,
    async lookup(key: string, maxItems: number) {
      calls.push(key);
      return { match: match(key), resultsConsumed: maxItems };
    },
  };
}

function cacheClient(over: Partial<CacheClient> & { monthUsage?: number; hits?: Record<string, { match: SupplierMatch | null }> } = {}): CacheClient & { stored: unknown[] } {
  const stored: unknown[] = [];
  return {
    stored,
    lookup: over.lookup ?? (async () => ({ hits: over.hits ?? {}, monthUsage: over.monthUsage ?? 0 })),
    store:
      over.store ??
      (async (entries) => {
        stored.push(...entries);
        return { monthUsage: (over.monthUsage ?? 0) + entries.reduce((s, e) => s + e.resultsConsumed, 0) };
      }),
  };
}

describe('resolveSuppliers — credit discipline', () => {
  it('(a) makes ZERO Apify calls when all survivors are cached', async () => {
    const provider = countingProvider();
    const k = normalizeQuery('Magnetic Phone Mount');
    const deps: SupplierDeps = {
      provider,
      cache: cacheClient({ hits: { [k]: { match: match('AE1') } } }),
      config: CONFIG,
    };

    const out = await resolveSuppliers([{ id: 's1', query: 'Magnetic Phone Mount' }], deps);

    expect(provider.calls).toHaveLength(0); // never touched Apify
    expect(out.get('s1')).toMatchObject({ supplierCheck: 'ok', match: { productId: 'AE1' } });
  });

  it('(b) stops calling and marks survivors pending once the monthly ceiling is hit', async () => {
    const provider = countingProvider();
    // Usage already at 998; budget 1000; maxItems 8 → 998 + 8 > 1000, so NO calls.
    const deps: SupplierDeps = { provider, cache: cacheClient({ monthUsage: 998 }), config: CONFIG };

    const out = await resolveSuppliers(
      [
        { id: 's1', query: 'dog nail grinder' },
        { id: 's2', query: 'herb grinder steel' },
      ],
      deps,
    );

    expect(provider.calls).toHaveLength(0); // ceiling blocked every call
    expect(out.get('s1')!.supplierCheck).toBe('pending');
    expect(out.get('s2')!.supplierCheck).toBe('pending');
    expect(out.get('s1')!.match).toBeNull();
  });

  it('(b2) resolves within budget, then defers the overflow to pending', async () => {
    const provider = countingProvider();
    // Budget 20, maxItems 8: first call 0→8 ok, second 8→16 ok, third 16+8>20 → pending.
    const deps: SupplierDeps = { provider, cache: cacheClient({ monthUsage: 0 }), config: { ...CONFIG, monthlyBudget: 20 } };

    const out = await resolveSuppliers(
      [
        { id: 'a', query: 'alpha widget' },
        { id: 'b', query: 'bravo gadget' },
        { id: 'c', query: 'charlie gizmo' },
      ],
      deps,
    );

    expect(provider.calls).toHaveLength(2); // only two fit under the ceiling
    const checks = ['a', 'b', 'c'].map((id) => out.get(id)!.supplierCheck).sort();
    expect(checks).toEqual(['ok', 'ok', 'pending']);
  });

  it('(c) dedupes equivalent queries to ONE Apify call and one cache key', async () => {
    const provider = countingProvider();
    const cache = cacheClient({ monthUsage: 0 });
    const deps: SupplierDeps = { provider, cache, config: CONFIG };

    const out = await resolveSuppliers(
      [
        { id: 'x', query: 'iPhone 15 Case Clear' },
        { id: 'y', query: 'clear case iphone 15' }, // same product, different phrasing
      ],
      deps,
    );

    expect(provider.calls).toHaveLength(1); // paid once, not twice
    expect(out.get('x')!.normalizedKey).toBe(out.get('y')!.normalizedKey);
    expect(cache.stored).toHaveLength(1); // one cache entry written
  });

  it('caps survivors at topN (survivor-only gate)', async () => {
    const provider = countingProvider();
    const deps: SupplierDeps = { provider, cache: cacheClient({ monthUsage: 0 }), config: { ...CONFIG, topN: 2 } };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = await resolveSuppliers(
      Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, query: `unique product ${i}` })),
      deps,
    );

    expect(out.size).toBe(2); // only the top 2 processed
    expect(provider.calls).toHaveLength(2);
    warn.mockRestore();
  });
});

describe('normalizeQuery', () => {
  it('collapses word order + strips marketing words', () => {
    expect(normalizeQuery('iPhone 15 Case Clear')).toBe(normalizeQuery('clear case iphone 15'));
    expect(normalizeQuery('NEW Hot Sale Dog Grinder FREE Shipping')).toBe('dog grinder');
  });
});
