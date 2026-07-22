import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, listings, settings, storefronts, supplierOffers, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { runRepricingSweep } from './repricingSweep.js';

const USER_ID = 'usr_reprice';
const STOREFRONT_ID = 'sf_reprice';
const SUPPLIER_ID = 'sup_reprice';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-reprice', email: 'reprice@test.dev', createdAt: 0 });
  await db.insert(settings).values({
    userId: USER_ID,
    minMarginCents: 200,
    marginMode: 'absolute',
    minMarginPercent: 20,
    autoFulfill: 1,
  });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'reprice-test-ebay-store',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
    createdAt: 0,
    oauthAccessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    oauthRefreshTokenRef: 'env:EBAY_OAUTH_REFRESH_TOKEN',
    oauthExpiresAt: Date.now() + 3600_000,
  });
  await db.insert(suppliers).values({
    id: SUPPLIER_ID,
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
});

describe('runRepricingSweep', () => {
  it('repriced a listing whose current price is far from the target margin', async () => {
    const db = createDb(env.DB);
    await db.insert(listings).values({
      id: 'lst_reprice_target',
      storefrontId: STOREFRONT_ID,
      externalListingId: 'ebay-listing-reprice-target',
      sku: 'WIDGET-RED-L',
      title: 'Widget Red Large',
      priceCents: 100_00, // deliberately far above the eventual cost-based target
      quantityAvailable: 10,
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ123456',
      matchConfidence: 1,
      matchSource: 'exact_sku',
      autoReprice: 1,
      autoPause: 1,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(supplierOffers).values({
      id: 'off_reprice_target',
      listingId: 'lst_reprice_target',
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ123456',
      costCents: 2000,
      shippingCents: 150,
      inStock: 1,
      shipDays: 7,
      score: 1,
      checkedAt: 0,
    });

    await runRepricingSweep(env);

    const [listing] = await db.select().from(listings).where(eq(listings.id, 'lst_reprice_target'));
    // target = (2000 + 150 + 0) / (1 - 0.20) = 2687.5 -> rounds to 2688
    expect(listing?.priceCents).toBe(2688);
    expect(listing?.status).toBe('active');
  });

  it('does not touch a listing whose current price is already close to target', async () => {
    const db = createDb(env.DB);
    await db.insert(listings).values({
      id: 'lst_reprice_close',
      storefrontId: STOREFRONT_ID,
      externalListingId: 'ebay-listing-reprice-close',
      sku: 'WIDGET-RED-L',
      title: 'Widget Red Large',
      priceCents: 2688, // already at target
      quantityAvailable: 10,
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ123456',
      matchConfidence: 1,
      matchSource: 'exact_sku',
      autoReprice: 1,
      autoPause: 1,
      status: 'active',
      createdAt: 0,
      updatedAt: 5,
    });
    await db.insert(supplierOffers).values({
      id: 'off_reprice_close',
      listingId: 'lst_reprice_close',
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ123456',
      costCents: 2000,
      shippingCents: 150,
      inStock: 1,
      shipDays: 7,
      score: 1,
      checkedAt: 0,
    });

    await runRepricingSweep(env);

    const [listing] = await db.select().from(listings).where(eq(listings.id, 'lst_reprice_close'));
    expect(listing?.updatedAt).toBe(5); // untouched
  });

  it('pauses a listing whose only offer is out of stock, skipping repricing', async () => {
    const db = createDb(env.DB);
    await db.insert(listings).values({
      id: 'lst_reprice_oos',
      storefrontId: STOREFRONT_ID,
      externalListingId: 'ebay-listing-reprice-oos',
      sku: 'GIZMO-GREEN-S',
      title: 'Gizmo Green Small',
      priceCents: 4999,
      quantityAvailable: 0,
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ999999',
      matchConfidence: 1,
      matchSource: 'exact_sku',
      autoReprice: 1,
      autoPause: 1,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(supplierOffers).values({
      id: 'off_reprice_oos',
      listingId: 'lst_reprice_oos',
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ999999',
      costCents: 1000,
      shippingCents: 100,
      inStock: 0,
      shipDays: 7,
      score: 1,
      checkedAt: 0,
    });

    await runRepricingSweep(env);

    const [listing] = await db.select().from(listings).where(eq(listings.id, 'lst_reprice_oos'));
    expect(listing?.status).toBe('paused_out_of_stock');
    expect(listing?.priceCents).toBe(4999); // not repriced — paused instead
  });

  it('ignores listings with autoReprice/autoPause both off', async () => {
    const db = createDb(env.DB);
    await db.insert(listings).values({
      id: 'lst_reprice_manual',
      storefrontId: STOREFRONT_ID,
      externalListingId: 'ebay-listing-reprice-manual',
      sku: 'WIDGET-RED-L',
      title: 'Widget Red Large',
      priceCents: 100_00,
      quantityAvailable: 0,
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ123456',
      matchConfidence: 1,
      matchSource: 'exact_sku',
      autoReprice: 0,
      autoPause: 0,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(supplierOffers).values({
      id: 'off_reprice_manual',
      listingId: 'lst_reprice_manual',
      supplierId: SUPPLIER_ID,
      supplierProductId: 'CJ123456',
      costCents: 2000,
      shippingCents: 150,
      inStock: 0,
      shipDays: 7,
      score: 1,
      checkedAt: 0,
    });

    await runRepricingSweep(env);

    const [listing] = await db.select().from(listings).where(eq(listings.id, 'lst_reprice_manual'));
    expect(listing?.status).toBe('active'); // not paused despite being out of stock
    expect(listing?.priceCents).toBe(100_00); // not repriced
  });
});
