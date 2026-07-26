import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, listings, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { and, eq } from 'drizzle-orm';
import type { OrderSource, OrderSourceListing, OrderSourceOrder, PushTrackingInput, UpdateListingInput } from '@fulfillment-tracker/adapters/orderSource';
import { syncListingsForStorefront } from './listingsSync.js';

const USER_ID = 'usr_lsync';
const OTHER_USER_ID = 'usr_lsync_other';
const STOREFRONT_ID = 'sf_lsync';

class FakeOrderSource implements OrderSource {
  constructor(private readonly fixture: OrderSourceListing[]) {}
  async listNewOrders(): Promise<OrderSourceOrder[]> {
    throw new Error('not used by listingsSync');
  }
  async getOrder(): Promise<OrderSourceOrder | null> {
    throw new Error('not used by listingsSync');
  }
  async pushTracking(_externalOrderId: string, _input: PushTrackingInput): Promise<void> {
    throw new Error('not used by listingsSync');
  }
  async sendBuyerMessage(): Promise<void> {
    throw new Error('not used by listingsSync');
  }
  async listListings(): Promise<OrderSourceListing[]> {
    return this.fixture;
  }
  async updateListing(_externalListingId: string, _input: UpdateListingInput): Promise<void> {
    throw new Error('not used by listingsSync');
  }
  async pauseListing(): Promise<void> {
    throw new Error('not used by listingsSync');
  }
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values([
    { id: USER_ID, clerkUserId: 'dev-user-lsync', email: 'lsync@test.dev', createdAt: 0 },
    { id: OTHER_USER_ID, clerkUserId: 'dev-user-lsync-other', email: 'lsync-other@test.dev', createdAt: 0 },
  ]);
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'lsync-store',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_CLIENT_SECRET',
    createdAt: 0,
  });
});

describe('syncListingsForStorefront', () => {
  it('inserts a new listings row per fetched listing and attempts to match it', async () => {
    const db = createDb(env.DB);
    const orderSource = new FakeOrderSource([
      { externalListingId: 'ext-1', sku: 'SKU-1', title: 'Widget One', priceCents: 1999, quantityAvailable: 5 },
    ]);

    await syncListingsForStorefront(env, db, STOREFRONT_ID, orderSource);

    const rows = await db.select().from(listings).where(eq(listings.storefrontId, STOREFRONT_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sku).toBe('SKU-1');
    expect(rows[0]?.externalListingId).toBe('ext-1');
    expect(rows[0]?.priceCents).toBe(1999);
    // No matchable API supplier exists for this user, so the match attempt
    // (still triggered) resolves to "no match" rather than throwing.
    expect(rows[0]?.supplierId).toBeNull();
  });

  it('updates an existing listing in place (matched by externalListingId) instead of duplicating it, and preserves its existing match', async () => {
    const db = createDb(env.DB);
    await db.insert(suppliers).values({
      id: 'sup_lsync_cj',
      userId: USER_ID,
      name: 'CJ Dropshipping',
      apiBaseUrl: 'https://developers.cjdropshipping.com',
      apiKeyRef: 'env:CJ_API_KEY',
      emailSenderPattern: '@cjdropshipping.com',
      parserId: 'cj-dropshipping-v1',
      active: 1,
      createdAt: 0,
      kind: 'api',
      provider: 'cj',
    });
    await db.insert(listings).values({
      id: 'lst_lsync_existing',
      storefrontId: STOREFRONT_ID,
      externalListingId: 'ext-1',
      sku: 'SKU-1',
      title: 'Stale Title',
      priceCents: 999,
      quantityAvailable: 1,
      supplierId: 'sup_lsync_cj',
      supplierProductId: 'already-matched-product',
      matchConfidence: 1,
      matchSource: 'manual',
      autoReprice: 1,
      autoPause: 1,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    });

    const orderSource = new FakeOrderSource([
      { externalListingId: 'ext-1', sku: 'SKU-1', title: 'Fresh Title', priceCents: 2500, quantityAvailable: 20 },
    ]);
    await syncListingsForStorefront(env, db, STOREFRONT_ID, orderSource);

    const rows = await db.select().from(listings).where(eq(listings.storefrontId, STOREFRONT_ID));
    expect(rows).toHaveLength(1); // updated, not duplicated
    expect(rows[0]?.title).toBe('Fresh Title');
    expect(rows[0]?.priceCents).toBe(2500);
    expect(rows[0]?.quantityAvailable).toBe(20);
    // Already-matched listings aren't re-run through the match cascade.
    expect(rows[0]?.supplierId).toBe('sup_lsync_cj');
    expect(rows[0]?.supplierProductId).toBe('already-matched-product');
  });

  it("only matches against the storefront owner's own suppliers, never another tenant's", async () => {
    const db = createDb(env.DB);
    await db.insert(suppliers).values({
      id: 'sup_lsync_other_tenant',
      userId: OTHER_USER_ID,
      name: 'Someone Else\'s CJ',
      apiBaseUrl: 'https://developers.cjdropshipping.com',
      apiKeyRef: 'env:CJ_API_KEY',
      emailSenderPattern: '@cjdropshipping.com',
      parserId: 'cj-dropshipping-v1',
      active: 1,
      createdAt: 0,
      kind: 'api',
      provider: 'cj',
    });

    const orderSource = new FakeOrderSource([
      { externalListingId: 'ext-2', sku: 'SKU-2', title: 'Gadget Two', priceCents: 3000, quantityAvailable: 3 },
    ]);
    await syncListingsForStorefront(env, db, STOREFRONT_ID, orderSource);

    const [row] = await db
      .select()
      .from(listings)
      .where(and(eq(listings.storefrontId, STOREFRONT_ID), eq(listings.externalListingId, 'ext-2')));
    expect(row?.supplierId).toBeNull(); // never matched to the other tenant's supplier
  });
});
