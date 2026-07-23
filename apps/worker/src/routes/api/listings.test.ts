import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, listings, storefronts, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user', 'Content-Type': 'application/json' };

const USER_ID = 'usr_title';
const STOREFRONT_ID = 'sf_title';
const LISTING_ID = 'lst_title';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user', email: 'title@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'title-test-ebay-store',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
    createdAt: 0,
    oauthAccessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    oauthRefreshTokenRef: 'env:EBAY_OAUTH_REFRESH_TOKEN',
    oauthExpiresAt: Date.now() + 3_600_000,
  });
  await db.insert(listings).values({
    id: LISTING_ID,
    storefrontId: STOREFRONT_ID,
    externalListingId: 'ebay-listing-title-test',
    sku: 'WIDGET-RED-L',
    title: 'Phone Case',
    priceCents: 1999,
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

describe('GET /api/listings', () => {
  it('lists listings scoped to the authed user storefronts', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/listings', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: { id: string }[] };
    expect(body.listings.map((l) => l.id)).toEqual([LISTING_ID]);
  });
});

describe('POST /api/listings/:id/optimize-title', () => {
  it('generates and persists a title suggestion without touching the marketplace listing', async () => {
    const res = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/optimize-title`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { suggestedTitle: string; reasoning: string };
    expect(body.suggestedTitle).not.toBe('');
    expect(body.reasoning).not.toBe('');

    const db = createDb(env.DB);
    const [listing] = await db.select().from(listings).where(eq(listings.id, LISTING_ID));
    expect(listing?.suggestedTitle).toBe(body.suggestedTitle);
    expect(listing?.titleSuggestionReasoning).toBe(body.reasoning);
    expect(listing?.titleSuggestedAt).not.toBeNull();
    expect(listing?.title).toBe('Phone Case'); // unchanged — suggestion only, not applied
  });

  it('404s for a listing outside the authed user storefronts', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/listings/does-not-exist/optimize-title', {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/listings/:id/apply-title', () => {
  it('rejects when there is no pending suggestion to apply', async () => {
    const res = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/apply-title`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(409);
  });

  it('applies a pending suggestion to the listing title and clears the suggestion fields', async () => {
    const optimizeRes = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/optimize-title`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    const { suggestedTitle } = (await optimizeRes.json()) as { suggestedTitle: string };

    const res = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/apply-title`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [listing] = await db.select().from(listings).where(eq(listings.id, LISTING_ID));
    expect(listing?.title).toBe(suggestedTitle); // the title actually applied is whatever the suggestion was
    expect(listing?.suggestedTitle).toBeNull();
    expect(listing?.titleSuggestionReasoning).toBeNull();
    expect(listing?.titleSuggestedAt).toBeNull();
  });
});
