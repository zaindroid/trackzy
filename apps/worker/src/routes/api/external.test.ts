import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, listings, storefronts, supplierOffers, suppliers, users } from '@fulfillment-tracker/db';
import { and, eq } from 'drizzle-orm';

const AUTH = { Authorization: 'Bearer dev-user-external', 'Content-Type': 'application/json' };
const USER_ID = 'usr_external';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    ebayItemId: '110445678901',
    sku: 'SRC-ABC',
    supplierProvider: 'cj',
    supplierProductId: 'CJ-PROD-1',
    costCents: 599,
    imageUrl: 'https://img.example/1.jpg',
    title: 'Silk Eye Mask',
    priceCents: 1499,
    ...overrides,
  };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-external', email: 'ext@test.dev', createdAt: 0 });
});

describe('POST /api/external/sourced-listing', () => {
  it('no-ops (linked: false) when the user has no eBay storefront in trackzy', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/external/sourced-listing', { method: 'POST', headers: AUTH, body: JSON.stringify(payload()) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, linked: false });
  });

  it('pre-seeds a deterministic listing + supplier_offer when eBay + CJ are both connected', async () => {
    const db = createDb(env.DB);
    await db.insert(storefronts).values({
      id: 'sf_ext',
      userId: USER_ID,
      platform: 'ebay',
      shopDomain: 'ebay-ext',
      accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
      createdAt: 0,
    });
    await db.insert(suppliers).values({
      id: 'sup_ext_cj',
      userId: USER_ID,
      name: 'CJ Dropshipping',
      apiBaseUrl: 'https://developers.cjdropshipping.com',
      apiKeyRef: 'env:CJ_API_KEY',
      emailSenderPattern: '@cjdropshipping.com',
      parserId: 'generic-fallback-v1',
      active: 1,
      createdAt: 0,
      kind: 'api',
      provider: 'cj',
    });

    const res = await SELF.fetch('https://worker.example.com/api/external/sourced-listing', { method: 'POST', headers: AUTH, body: JSON.stringify(payload()) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, linked: true });

    const [listing] = await db.select().from(listings).where(and(eq(listings.storefrontId, 'sf_ext'), eq(listings.externalListingId, '110445678901')));
    expect(listing?.sku).toBe('SRC-ABC');
    expect(listing?.supplierId).toBe('sup_ext_cj');
    expect(listing?.supplierProductId).toBe('CJ-PROD-1');
    expect(listing?.matchSource).toBe('manual');

    const [offer] = await db.select().from(supplierOffers).where(eq(supplierOffers.listingId, listing!.id));
    expect(offer?.costCents).toBe(599);
    expect(offer?.supplierId).toBe('sup_ext_cj');
  });

  it('400s on a malformed payload', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/external/sourced-listing', { method: 'POST', headers: AUTH, body: JSON.stringify({ sku: 'x' }) });
    expect(res.status).toBe(400);
  });
});
