import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, storefronts, users } from '@fulfillment-tracker/db';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user-sf', 'Content-Type': 'application/json' };
const OTHER_AUTH_HEADERS = { Authorization: 'Bearer dev-user-sf-other', 'Content-Type': 'application/json' };
const USER_ID = 'usr_sf_list';
const OTHER_USER_ID = 'usr_sf_other';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values([
    { id: USER_ID, clerkUserId: 'dev-user-sf', email: 'sf@test.dev', createdAt: 0 },
    { id: OTHER_USER_ID, clerkUserId: 'dev-user-sf-other', email: 'sf-other@test.dev', createdAt: 0 },
  ]);
  await db.insert(storefronts).values([
    {
      id: 'sf_mine',
      userId: USER_ID,
      platform: 'ebay',
      shopDomain: 'ebay-usr_sf_list',
      accessTokenRef: 'PLACEHOLDER__NOT_APPLICABLE_EBAY_STOREFRONT',
      webhookSecretRef: 'PLACEHOLDER__NOT_APPLICABLE_EBAY_STOREFRONT',
      nonApiMode: 1,
      createdAt: 0,
    },
    {
      id: 'sf_other',
      userId: OTHER_USER_ID,
      platform: 'ebay',
      shopDomain: 'ebay-usr_sf_other',
      accessTokenRef: 'PLACEHOLDER__NOT_APPLICABLE_EBAY_STOREFRONT',
      webhookSecretRef: 'PLACEHOLDER__NOT_APPLICABLE_EBAY_STOREFRONT',
      nonApiMode: 1,
      createdAt: 0,
    },
  ]);
});

describe('GET /api/storefronts', () => {
  it('returns only the authenticated user\'s own storefronts', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/storefronts', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { storefronts: { id: string; platform: string }[] };
    expect(body.storefronts).toHaveLength(1);
    expect(body.storefronts[0]?.id).toBe('sf_mine');
  });

  it('never leaks another user\'s storefront', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/storefronts', { headers: OTHER_AUTH_HEADERS });
    const body = (await res.json()) as { storefronts: { id: string }[] };
    expect(body.storefronts.map((s) => s.id)).toEqual(['sf_other']);
  });
});
