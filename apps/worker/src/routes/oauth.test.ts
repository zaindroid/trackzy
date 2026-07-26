import { describe, expect, it, vi, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, listings, oauthConnectStates, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { decryptCredential } from '../lib/credentialCrypto.js';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user-oauth', 'Content-Type': 'application/json' };
const USER_ID = 'usr_oauth';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-oauth', email: 'oauth@test.dev', createdAt: 0 });
});

async function startAliExpressFlow(): Promise<string> {
  const res = await SELF.fetch('https://worker.example.com/api/connections/aliexpress/start', { headers: AUTH_HEADERS });
  const body = (await res.json()) as { redirectUrl: string };
  return new URL(body.redirectUrl).searchParams.get('state')!;
}

async function startEbayFlow(): Promise<string> {
  const res = await SELF.fetch('https://worker.example.com/api/connections/ebay/start', { headers: AUTH_HEADERS });
  const body = (await res.json()) as { redirectUrl: string };
  return new URL(body.redirectUrl).searchParams.get('state')!;
}

describe('GET /oauth/ebay/callback', () => {
  it('exchanges the code, creates a storefront row, and syncs the account\'s existing listings in', async () => {
    const state = await startEbayFlow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'eb-access-1', refresh_token: 'eb-refresh-1', expires_in: 7200 })),
    );

    const res = await SELF.fetch(`https://worker.example.com/oauth/ebay/callback?code=auth-code&state=${state}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('eBay connected');

    const db = createDb(env.DB);
    const [storefront] = await db.select().from(storefronts).where(eq(storefronts.userId, USER_ID));
    expect(storefront?.platform).toBe('ebay');
    expect(storefront?.oauthAccessTokenRef).toMatch(/^enc:v1:/);
    expect(await decryptCredential(env, storefront!.oauthAccessTokenRef!)).toBe('eb-access-1');

    // The mock eBay adapter's listListings() fixture (two listings) should
    // already be synced in — proof the connect flow doesn't leave a brand
    // new customer with an empty catalog until the next cron tick.
    const syncedListings = await db.select().from(listings).where(eq(listings.storefrontId, storefront!.id));
    expect(syncedListings).toHaveLength(2);
    expect(syncedListings.map((l) => l.sku).sort()).toEqual(['GIZMO-GREEN-S', 'WIDGET-RED-L']);

    vi.unstubAllGlobals();
  });
});

describe('GET /oauth/aliexpress/callback', () => {
  it('exchanges the code (TOP-signed) and creates a suppliers row with encrypted, rotated tokens', async () => {
    const state = await startAliExpressFlow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'ae-access-1', refresh_token: 'ae-refresh-1', expire_time: Date.now() + 86_400_000, code: '0' })),
    );

    const res = await SELF.fetch(`https://worker.example.com/oauth/aliexpress/callback?code=auth-code&state=${state}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('AliExpress connected');

    const db = createDb(env.DB);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(supplier?.provider).toBe('aliexpress');
    expect(supplier?.oauthAccessTokenRef).toMatch(/^enc:v1:/);
    expect(await decryptCredential(env, supplier!.oauthAccessTokenRef!)).toBe('ae-access-1');
    expect(await decryptCredential(env, supplier!.oauthRefreshTokenRef!)).toBe('ae-refresh-1');

    vi.unstubAllGlobals();
  });

  it('rejects a reused or unknown state', async () => {
    const res = await SELF.fetch('https://worker.example.com/oauth/aliexpress/callback?code=x&state=never-existed');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('connection failed');
  });

  it('handles a missing code param without a crash', async () => {
    const res = await SELF.fetch('https://worker.example.com/oauth/aliexpress/callback');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('Missing code or state');
  });

  it('surfaces an AliExpress-reported error code rather than silently creating a supplier row', async () => {
    const state = await startAliExpressFlow();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'InvalidCode', message: 'code expired' })));

    const res = await SELF.fetch(`https://worker.example.com/oauth/aliexpress/callback?code=bad-code&state=${state}`);
    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toContain('InvalidCode');

    const db = createDb(env.DB);
    const rows = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(rows).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});

describe('OAuth connect state expiry (shared by eBay + AliExpress callbacks)', () => {
  it('rejects an expired state', async () => {
    const db = createDb(env.DB);
    await db.insert(oauthConnectStates).values({ state: 'old-ae-state', userId: USER_ID, provider: 'aliexpress', createdAt: 0 });

    const res = await SELF.fetch('https://worker.example.com/oauth/aliexpress/callback?code=x&state=old-ae-state');
    expect(res.status).toBe(400);
  });
});
