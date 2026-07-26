import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, listings, storefronts, suppliers, users } from '@fulfillment-tracker/db';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user-metrics', 'Content-Type': 'application/json' };
const USER_ID = 'usr_metrics';
const STOREFRONT_ID = 'sf_metrics';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-metrics', email: 'metrics@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'metrics-store',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: 'sup_metrics',
    userId: USER_ID,
    name: 'CJ Dropshipping',
    apiBaseUrl: '',
    apiKeyRef: 'env:CJ_API_KEY',
    emailSenderPattern: '@cjdropshipping.com',
    parserId: 'cj-dropshipping-v1',
    active: 1,
    createdAt: 0,
    kind: 'api',
    provider: 'cj',
  });
  await db.insert(listings).values([
    {
      id: 'lst_metrics_matched',
      storefrontId: STOREFRONT_ID,
      externalListingId: 'ext-1',
      sku: 'SKU-1',
      title: 'Matched Listing',
      priceCents: 1000,
      quantityAvailable: 1,
      supplierId: 'sup_metrics',
      supplierProductId: 'prod-1',
      matchConfidence: 1,
      matchSource: 'manual',
      autoReprice: 1,
      autoPause: 1,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'lst_metrics_unmatched',
      storefrontId: STOREFRONT_ID,
      externalListingId: 'ext-2',
      sku: 'SKU-2',
      title: 'Unmatched Listing',
      priceCents: 2000,
      quantityAvailable: 1,
      supplierId: null,
      supplierProductId: null,
      matchConfidence: null,
      matchSource: null,
      autoReprice: 1,
      autoPause: 1,
      status: 'active',
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
});

describe('GET /api/metrics — listings counts', () => {
  it('reports total and matched listing counts for the dashboard summary', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/metrics', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listingsTotal: number; listingsMatched: number };
    expect(body.listingsTotal).toBe(2);
    expect(body.listingsMatched).toBe(1);
  });
});
