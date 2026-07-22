import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, listings, storefronts, supplierOffers, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { matchListing } from './matchListing.js';

const USER_ID = 'usr_match';
const STOREFRONT_ID = 'sf_match';
const LISTING_ID = 'lst_match';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-match', email: 'match@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'match-test-ebay-store',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(listings).values({
    id: LISTING_ID,
    storefrontId: STOREFRONT_ID,
    externalListingId: 'ebay-listing-match-test',
    sku: 'WIDGET-RED-L',
    title: 'Widget Red Large',
    priceCents: 5999,
    quantityAvailable: 10,
    supplierId: null,
    supplierProductId: null,
    matchConfidence: null,
    matchSource: null,
    autoReprice: 1,
    autoPause: 1,
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
  });
});

describe('matchListing', () => {
  it('returns an unmatched result and touches no adapters when no API supplier is active', async () => {
    const result = await matchListing(env, LISTING_ID);
    expect(result).toEqual({ supplierProductId: null, confidence: 0, source: null });

    const db = createDb(env.DB);
    const [listing] = await db.select().from(listings).where(eq(listings.id, LISTING_ID));
    expect(listing?.supplierProductId).toBeNull();
  });

  it('finds and persists a match via the cascade when a matchable supplier is active, and stores a supplier_offers row', async () => {
    const db = createDb(env.DB);
    await db.insert(suppliers).values({
      id: 'sup_match_cj',
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

    const result = await matchListing(env, LISTING_ID);

    expect(result.supplierProductId).not.toBeNull();
    expect(result.source).not.toBe('exact_sku'); // the mock supplier never returns a sku, so exact_sku can't win
    expect(result.confidence).toBeGreaterThan(0);

    const [listing] = await db.select().from(listings).where(eq(listings.id, LISTING_ID));
    expect(listing?.supplierId).toBe('sup_match_cj');
    expect(listing?.supplierProductId).toBe(result.supplierProductId);
    expect(listing?.matchConfidence).toBe(result.confidence);
    expect(listing?.matchSource).toBe(result.source);

    const [offer] = await db.select().from(supplierOffers).where(eq(supplierOffers.listingId, LISTING_ID));
    expect(offer?.supplierId).toBe('sup_match_cj');
    expect(offer?.costCents).toBeGreaterThan(0);
  });

  it('ignores inactive and non-API-matchable suppliers (e.g. kind=manual)', async () => {
    const db = createDb(env.DB);
    await db.insert(suppliers).values([
      {
        id: 'sup_match_inactive',
        userId: USER_ID,
        name: 'Inactive CJ',
        apiBaseUrl: 'https://developers.cjdropshipping.com',
        apiKeyRef: 'env:CJ_API_KEY',
        emailSenderPattern: '@cjdropshipping.com',
        parserId: 'cj-dropshipping-v1',
        active: 0,
        createdAt: 0,
        kind: 'api',
        provider: 'cj',
      },
      {
        id: 'sup_match_manual',
        userId: USER_ID,
        name: 'Amazon Retail (Manual)',
        apiBaseUrl: 'https://www.amazon.com',
        apiKeyRef: 'PLACEHOLDER__NO_API_KEY_MANUAL_SUPPLIER',
        emailSenderPattern: '@amazon.com',
        parserId: 'amazon-retail-manual-v1',
        active: 1,
        createdAt: 0,
        kind: 'manual',
        provider: 'amazon_retail',
      },
    ]);

    const result = await matchListing(env, LISTING_ID);
    expect(result).toEqual({ supplierProductId: null, confidence: 0, source: null });
  });
});
