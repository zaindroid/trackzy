import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { apifyUsage, createDb, radarProducts, sellerSettings, supplierCache, users } from '@sourcing/db';

const INGEST_TOKEN = 'test-radar-ingest-token-0123456789'; // matches vitest.config.ts
const BASE = 'https://sourcing.example.com';

function sampleItem(over: Record<string, unknown> = {}) {
  return {
    niche: 'phone accessories',
    productTitle: 'Magnetic Phone Mount',
    ebaySoldCount: 120,
    salesPerDay: 4,
    ebayActiveCount: 40,
    sellThroughPercent: 75,
    ebayMedianSoldPriceCents: 1599,
    aliexpressProductId: 'AE1',
    aliexpressUrl: 'https://www.aliexpress.com/item/1.html',
    aliexpressCostCents: 300,
    sourceable: true,
    marginCents: 900,
    marginPercent: 56,
    opportunityScore: 72,
    ...over,
  };
}

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.delete(radarProducts);
  // The read route auto-provisions the caller; give them a fee setting so margin
  // recompute is exercised. authMiddleware maps Bearer <token> -> clerkUserId.
  await db.insert(users).values({ id: 'usr_radar', clerkUserId: 'radar-user', email: 'r@test.dev', createdAt: 0 }).onConflictDoNothing();
  await db
    .insert(sellerSettings)
    .values({ userId: 'usr_radar', ebayFeePercent: 10, updatedAt: 0 })
    .onConflictDoNothing();
});

describe('POST /ingest/radar', () => {
  it('rejects a missing/invalid token with 401', async () => {
    const res = await SELF.fetch(`${BASE}/ingest/radar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong' },
      body: JSON.stringify({ items: [sampleItem()] }),
    });
    expect(res.status).toBe(401);
  });

  it('replaces the table with the posted snapshot when authorized', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(radarProducts).values({ id: 'stale', niche: 'old', productTitle: 'Old', lastUpdated: 0, createdAt: 0 });

    const res = await SELF.fetch(`${BASE}/ingest/radar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST_TOKEN}` },
      body: JSON.stringify({ mode: 'replace', items: [sampleItem(), sampleItem({ productTitle: 'Second' })] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { itemsWritten: number };
    expect(body.itemsWritten).toBe(2);

    const rows = await db.select().from(radarProducts);
    expect(rows).toHaveLength(2); // stale row gone
    expect(rows.every((r) => r.niche === 'phone accessories')).toBe(true);
  });

  it('ingests more rows than the D1 param cap allows in one insert (chunking)', async () => {
    // 6 rows x 21 cols = 126 params > D1's 100 cap → must be chunked to succeed.
    const items = Array.from({ length: 6 }, (_, i) => sampleItem({ productTitle: `Product ${i}`, aliexpressProductId: `AE${i}` }));
    const res = await SELF.fetch(`${BASE}/ingest/radar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST_TOKEN}` },
      body: JSON.stringify({ mode: 'replace', items }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { itemsWritten: number }).itemsWritten).toBe(6);
    const db = createDb(env.SOURCING_DB);
    expect(await db.select().from(radarProducts)).toHaveLength(6);
  });

  it('400s on an invalid body', async () => {
    const res = await SELF.fetch(`${BASE}/ingest/radar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST_TOKEN}` },
      body: JSON.stringify({ items: [{ productTitle: 'no niche' }] }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/radar', () => {
  it('returns ranked products with margin recomputed for the seller fee', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(radarProducts).values({
      id: 'p1',
      niche: 'phone accessories',
      productTitle: 'Magnetic Phone Mount',
      ebayMedianSoldPriceCents: 1599,
      aliexpressCostCents: 300,
      sourceable: 1,
      marginCents: 0,
      marginPercent: 0,
      opportunityScore: 72,
      lastUpdated: 1,
      createdAt: 1,
    });

    const res = await SELF.fetch(`${BASE}/api/radar`, { headers: { Authorization: 'Bearer radar-user' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { products: { marginCents: number; sourceable: boolean }[]; feePercentUsed: number };
    expect(body.feePercentUsed).toBe(10);
    // 1599 - 300 - 10% fee (160) = 1139
    expect(body.products[0]!.marginCents).toBe(1139);
    expect(body.products[0]!.sourceable).toBe(true);
  });

  it('requires auth', async () => {
    const res = await SELF.fetch(`${BASE}/api/radar`);
    expect(res.status).toBe(401);
  });
});

describe('Supplier cache + budget (/ingest/radar/supplier/*)', () => {
  beforeEach(async () => {
    const db = createDb(env.SOURCING_DB);
    await db.delete(supplierCache);
    await db.delete(apifyUsage);
  });

  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST_TOKEN}` };

  it('lookup returns only FRESH hits; stale entries are treated as misses', async () => {
    const db = createDb(env.SOURCING_DB);
    const nowMs = Date.now();
    await db.insert(supplierCache).values([
      { normalizedKey: 'fresh key', matchJson: JSON.stringify({ productId: 'AE1', url: 'u', costCents: 300 }), sourceable: 1, lastChecked: nowMs },
      { normalizedKey: 'stale key', matchJson: null, sourceable: 0, lastChecked: nowMs - 40 * 86_400_000 },
    ]);

    const res = await SELF.fetch(`${BASE}/ingest/radar/supplier/lookup`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ keys: ['fresh key', 'stale key', 'never seen'], ttlDays: 10 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Record<string, { match: unknown }>; monthUsage: number };
    expect(Object.keys(body.hits)).toEqual(['fresh key']); // stale + unseen are misses
    expect(body.hits['fresh key']!.match).toMatchObject({ productId: 'AE1' });
    expect(body.monthUsage).toBe(0);
  });

  it('store caches entries and increments this month\'s Apify usage counter', async () => {
    const store = await SELF.fetch(`${BASE}/ingest/radar/supplier/store`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        entries: [
          { key: 'clear iphone case', match: { productId: 'AE9', url: 'u9', costCents: 250 }, resultsConsumed: 8 },
          { key: 'dead niche', match: null, resultsConsumed: 8 },
        ],
      }),
    });
    expect(store.status).toBe(200);
    expect(((await store.json()) as { monthUsage: number }).monthUsage).toBe(16);

    // A second store accumulates rather than overwrites.
    const store2 = await SELF.fetch(`${BASE}/ingest/radar/supplier/store`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ entries: [{ key: 'another', match: null, resultsConsumed: 5 }] }),
    });
    expect(((await store2.json()) as { monthUsage: number }).monthUsage).toBe(21);

    const db = createDb(env.SOURCING_DB);
    const [cached] = await db.select().from(supplierCache).where(eq(supplierCache.normalizedKey, 'clear iphone case'));
    expect(cached!.sourceable).toBe(1);
    const monthKey = new Date().toISOString().slice(0, 7);
    const [usage] = await db.select().from(apifyUsage).where(eq(apifyUsage.monthKey, monthKey));
    expect(usage!.resultsConsumed).toBe(21);
  });

  it('rejects supplier endpoints without the ingest token', async () => {
    const res = await SELF.fetch(`${BASE}/ingest/radar/supplier/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: ['x'] }),
    });
    expect(res.status).toBe(401);
  });
});
