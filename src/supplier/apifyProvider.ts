import type { SupplierMatch, SupplierProvider } from './types.js';

function priceToCents(raw: unknown): number {
  if (raw == null) return 0;
  const m = String(raw).match(/([\d,]+\.?\d*)/);
  return m ? Math.round(Number(m[1]!.replace(/,/g, '')) * 100) : 0;
}

/**
 * Apify AliExpress-products provider — the active supplier source for now.
 * Layer 5 (sync + tight timeout): uses run-sync-get-dataset-items (one blocking
 * call, no polling) with an AbortController so a stuck run can't silently burn
 * credit. `resultsConsumed` is the ACTUAL number of results returned (the Apify
 * billing unit), which the orchestrator counts against the monthly ceiling.
 *
 * NOTE: this actor has a ~50 maxProducts floor, so `maxItems` is the requested
 * size but real consumption may be higher — swap to the Affiliate API provider
 * (no per-result cost) to make `maxItems` truly binding.
 */
export class ApifyAliexpressProvider implements SupplierProvider {
  readonly source = 'apify:aliexpress';

  constructor(
    private readonly token: string,
    private readonly actorId: string,
    private readonly timeoutMs: number,
  ) {}

  async lookup(query: string, maxItems: number): Promise<{ match: SupplierMatch | null; resultsConsumed: number }> {
    const url = `https://api.apify.com/v2/acts/${this.actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(this.token)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // This actor enforces maxProducts >= 50, so we can't actually request
      // fewer — `maxItems` only bounds what we KEEP, and resultsConsumed counts
      // what the actor actually returned (the honest billing unit). The
      // Affiliate-API provider has no such floor / no per-result cost.
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchQueries: [query], maxProducts: Math.max(maxItems, 50), sortBy: 'orders' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Apify actor ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const items = (await res.json()) as Record<string, unknown>[];
      const resultsConsumed = Array.isArray(items) ? items.length : 0;
      if (resultsConsumed === 0) return { match: null, resultsConsumed: 0 };

      // Cheapest plausible priced result (already order-sorted for relevance).
      const priced = items
        .map((raw) => ({ raw, cents: priceToCents(raw.priceCurrent ?? raw.priceCurrentMin) }))
        .filter((p) => p.cents > 0)
        .sort((a, b) => a.cents - b.cents);
      if (priced.length === 0) return { match: null, resultsConsumed };

      const best = priced[0]!.raw;
      const match: SupplierMatch = {
        productId: String(best.productId ?? ''),
        url: best.productUrl ? String(best.productUrl) : '',
        costCents: priced[0]!.cents,
        orders: best.soldCount != null ? Number(best.soldCount) : undefined,
        imageUrl: best.imageUrl ? String(best.imageUrl) : undefined,
      };
      return { match, resultsConsumed };
    } finally {
      clearTimeout(timer);
    }
  }
}
