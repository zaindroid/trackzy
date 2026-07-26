import { describe, expect, it, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, demandCache } from '@sourcing/db';
import type { EbayDemandResult, ScraperEbayClient } from '@fulfillment-tracker/adapters/scraperEbay';
import { cachedDemand, normalizeNiche } from './demandCache.js';

const SAMPLE: EbayDemandResult = { items: [{ priceCents: 1500, freeShipping: true, itemsSold: 100 }], totalSold: 100, medianPriceCents: 1500 };

function stubClient(): ScraperEbayClient & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async searchDemand() {
      calls++;
      return SAMPLE;
    },
  } as ScraperEbayClient & { calls: number };
}

beforeEach(async () => {
  await createDb(env.SOURCING_DB).delete(demandCache);
});

describe('normalizeNiche', () => {
  it('collapses word order + strips filler so equivalents share a key', () => {
    expect(normalizeNiche('LED Strip Lights')).toBe(normalizeNiche('lights the led strip'));
    expect(normalizeNiche('Best Premium Dog Grinder')).toBe('dog grinder');
  });
});

describe('cachedDemand', () => {
  it('calls ScraperAPI on a miss, then serves the cache on a hit (no 2nd call)', async () => {
    const db = createDb(env.SOURCING_DB);
    const client = stubClient();
    const key = normalizeNiche('led strip lights');

    const first = await cachedDemand(db, client, key, 'led strip lights');
    expect(first.totalSold).toBe(100);
    expect(client.calls).toBe(1);

    const second = await cachedDemand(db, client, key, 'led strip lights');
    expect(second.totalSold).toBe(100);
    expect(client.calls).toBe(1); // served from cache — no extra credit spent

    const rows = await db.select().from(demandCache);
    expect(rows).toHaveLength(1);
  });
});
