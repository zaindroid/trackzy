import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, listings, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { encryptCredential, decryptCredential } from './lib/credentialCrypto.js';
import { handleScheduled, ALIEXPRESS_KEEPALIVE_CRON, LISTINGS_SYNC_CRON } from './scheduled.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeScheduledController(cron: string): ScheduledController {
  return { cron, scheduledTime: Date.now(), noRetry: () => undefined } as unknown as ScheduledController;
}

const USER_ID = 'usr_keepalive';
const SUPPLIER_ID = 'sup_keepalive';

describe('ALIEXPRESS_KEEPALIVE_CRON', () => {
  it('refreshes an AliExpress supplier whose token is stale relative to the wide keepalive margin, and re-encrypts the result', async () => {
    const db = createDb(env.DB);
    await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-keepalive', email: 'k@test.dev', createdAt: 0 });
    await db.insert(suppliers).values({
      id: SUPPLIER_ID,
      userId: USER_ID,
      name: 'AliExpress',
      apiBaseUrl: 'https://api-sg.aliexpress.com/sync',
      apiKeyRef: 'PLACEHOLDER__NOT_APPLICABLE_ALIEXPRESS_SUPPLIER',
      emailSenderPattern: '@aliexpress.com',
      parserId: 'aliexpress-v1',
      kind: 'api',
      provider: 'aliexpress',
      active: 1,
      oauthAccessTokenRef: await encryptCredential(env, 'stale-access'),
      oauthRefreshTokenRef: await encryptCredential(env, 'stale-refresh'),
      // 10 hours out — outside a real-traffic 5-min margin, but well within the 24h keepalive margin.
      oauthExpiresAt: Date.now() + 10 * 3600_000,
      createdAt: 0,
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh', expire_time: Date.now() + 86_400_000, code: '0' }),
      ),
    );

    await handleScheduled(fakeScheduledController(ALIEXPRESS_KEEPALIVE_CRON), env);

    const [updated] = await db.select().from(suppliers).where(eq(suppliers.id, SUPPLIER_ID));
    expect(updated?.oauthAccessTokenRef).toMatch(/^enc:v1:/);
    expect(await decryptCredential(env, updated!.oauthAccessTokenRef!)).toBe('refreshed-access');

    vi.unstubAllGlobals();
  });

  it('skips a supplier with no OAuth connection configured, without throwing', async () => {
    const db = createDb(env.DB);
    await db.insert(users).values({ id: 'usr_no_conn', clerkUserId: 'dev-user-no-conn', email: 'nc@test.dev', createdAt: 0 });
    await db.insert(suppliers).values({
      id: 'sup_no_conn',
      userId: 'usr_no_conn',
      name: 'AliExpress',
      apiBaseUrl: 'https://api-sg.aliexpress.com/sync',
      apiKeyRef: 'PLACEHOLDER__NOT_APPLICABLE_ALIEXPRESS_SUPPLIER',
      emailSenderPattern: '@aliexpress.com',
      parserId: 'aliexpress-v1',
      kind: 'api',
      provider: 'aliexpress',
      active: 1,
      createdAt: 0,
    });

    await expect(handleScheduled(fakeScheduledController(ALIEXPRESS_KEEPALIVE_CRON), env)).resolves.not.toThrow();
  });
});

describe('LISTINGS_SYNC_CRON', () => {
  it('syncs every connected eBay/Amazon storefront on its own tighter cadence than order polling', async () => {
    const db = createDb(env.DB);
    await db.insert(users).values({ id: 'usr_lsync_cron', clerkUserId: 'dev-user-lsync-cron', email: 'lsync-cron@test.dev', createdAt: 0 });
    await db.insert(storefronts).values({
      id: 'sf_lsync_cron',
      userId: 'usr_lsync_cron',
      platform: 'ebay',
      shopDomain: 'lsync-cron-store',
      accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      webhookSecretRef: 'env:EBAY_CLIENT_SECRET',
      oauthAccessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      oauthRefreshTokenRef: 'env:EBAY_OAUTH_REFRESH_TOKEN',
      oauthExpiresAt: Date.now() + 3600_000,
      createdAt: 0,
    });

    await handleScheduled(fakeScheduledController(LISTINGS_SYNC_CRON), env);

    const rows = await db.select().from(listings).where(eq(listings.storefrontId, 'sf_lsync_cron'));
    expect(rows.length).toBeGreaterThan(0); // the mock eBay adapter's fixture listings synced in
  });
});
