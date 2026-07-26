import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, listings, storefronts, suppliers, supplierOffers, users } from '@fulfillment-tracker/db';
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

describe('POST /api/listings/sync', () => {
  it("syncs the user's connected storefronts on demand, without waiting for the background cron", async () => {
    const res = await SELF.fetch('https://worker.example.com/api/listings/sync', { method: 'POST', headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storefronts: { storefrontId: string; platform: string; synced: boolean }[] };
    expect(body.storefronts).toEqual([{ storefrontId: STOREFRONT_ID, platform: 'ebay', synced: true }]);

    const db = createDb(env.DB);
    const rows = await db.select().from(listings).where(eq(listings.storefrontId, STOREFRONT_ID));
    // The pre-existing listing plus the mock eBay adapter's two fixture listings.
    expect(rows.length).toBe(3);
  });
});

describe('GET /api/listings/:id/candidates and POST /api/listings/:id/match — manual resolution', () => {
  const SUPPLIER_ID = 'sup_title_cj';

  beforeEach(async () => {
    const db = createDb(env.DB);
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

  it('returns scored candidates for a listing without committing anything', async () => {
    const res = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/candidates`, { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: { supplierId: string; supplierProductId: string; costCents: number }[] };
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates[0]?.supplierId).toBe(SUPPLIER_ID);

    const db = createDb(env.DB);
    const [listing] = await db.select().from(listings).where(eq(listings.id, LISTING_ID));
    expect(listing?.supplierId).toBeNull(); // just a preview — nothing committed yet
  });

  it('commits a manually-picked candidate, including a supplier_offers row (with product title/image/link) for margin evaluation and visual review', async () => {
    const candidatesRes = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/candidates`, { headers: AUTH_HEADERS });
    const { candidates } = (await candidatesRes.json()) as {
      candidates: { supplierId: string; supplierProductId: string; title: string; imageUrl?: string; productUrl?: string }[];
    };
    const chosen = candidates[0]!;
    expect(chosen.imageUrl).toBeTruthy(); // the mock CJ client maps a deterministic image URL
    expect(chosen.productUrl).toBeTruthy(); // and a deterministic product-page link

    const res = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/match`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        supplierId: chosen.supplierId,
        supplierProductId: chosen.supplierProductId,
        title: chosen.title,
        imageUrl: chosen.imageUrl,
        productUrl: chosen.productUrl,
      }),
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [listing] = await db.select().from(listings).where(eq(listings.id, LISTING_ID));
    expect(listing?.supplierId).toBe(chosen.supplierId);
    expect(listing?.supplierProductId).toBe(chosen.supplierProductId);
    expect(listing?.matchSource).toBe('manual');

    const listResRes = await SELF.fetch('https://worker.example.com/api/listings', { headers: AUTH_HEADERS });
    const { listings: listingRows } = (await listResRes.json()) as {
      listings: { id: string; matchedProductTitle: string | null; matchedProductImageUrl: string | null; matchedProductUrl: string | null }[];
    };
    const matched = listingRows.find((l) => l.id === LISTING_ID);
    expect(matched?.matchedProductTitle).toBe(chosen.title);
    expect(matched?.matchedProductImageUrl).toBe(chosen.imageUrl);
    expect(matched?.matchedProductUrl).toBe(chosen.productUrl);

    const [offer] = await db.select().from(supplierOffers).where(eq(supplierOffers.listingId, LISTING_ID));
    expect(offer?.supplierId).toBe(chosen.supplierId);
    expect(offer?.costCents).toBeGreaterThan(0);
  });

  it('marks a listing as deliberately unmatched (reviewed) rather than leaving it ambiguous', async () => {
    const res = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/match`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ supplierId: null }),
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [listing] = await db.select().from(listings).where(eq(listings.id, LISTING_ID));
    expect(listing?.supplierId).toBeNull();
    expect(listing?.matchSource).toBe('manual'); // distinguishes "reviewed, no match" from "never looked at"
  });

  it("rejects matching a listing to another tenant's supplier", async () => {
    const db = createDb(env.DB);
    await db.insert(users).values({ id: 'usr_title_other', clerkUserId: 'dev-user-other', email: 'other@test.dev', createdAt: 0 });
    await db.insert(suppliers).values({
      id: 'sup_title_other_tenant',
      userId: 'usr_title_other',
      name: 'Someone Else CJ',
      apiBaseUrl: 'https://developers.cjdropshipping.com',
      apiKeyRef: 'env:CJ_API_KEY',
      emailSenderPattern: '@cjdropshipping.com',
      parserId: 'cj-dropshipping-v1',
      active: 1,
      createdAt: 0,
      kind: 'api',
      provider: 'cj',
    });

    const res = await SELF.fetch(`https://worker.example.com/api/listings/${LISTING_ID}/match`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ supplierId: 'sup_title_other_tenant', supplierProductId: 'whatever' }),
    });
    expect(res.status).toBe(404);
  });
});
