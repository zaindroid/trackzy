import { describe, expect, it, vi, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, oauthConnectStates, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { decryptCredential } from '../../lib/credentialCrypto.js';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user-conn', 'Content-Type': 'application/json' };
const USER_ID = 'usr_conn';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-conn', email: 'conn@test.dev', createdAt: 0 });
});

describe('GET /api/connections/ebay/start', () => {
  it('returns eBay\'s consent URL as JSON (not a raw redirect — a plain navigation can\'t carry the Bearer token) with a state param, and records the state for this user', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/connections/ebay/start', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { redirectUrl: string };
    const location = new URL(body.redirectUrl);
    expect(location.origin).toBe('https://auth.ebay.com');
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();

    const db = createDb(env.DB);
    const [row] = await db.select().from(oauthConnectStates).where(eq(oauthConnectStates.state, state!));
    expect(row?.userId).toBe(USER_ID);
    expect(row?.provider).toBe('ebay');
  });

  it('401s without auth', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/connections/ebay/start');
    expect(res.status).toBe(401);
  });
});

describe('GET /oauth/ebay/callback', () => {
  async function startFlow(): Promise<string> {
    const res = await SELF.fetch('https://worker.example.com/api/connections/ebay/start', { headers: AUTH_HEADERS });
    const body = (await res.json()) as { redirectUrl: string };
    return new URL(body.redirectUrl).searchParams.get('state')!;
  }

  it('exchanges the code, encrypts the tokens, and creates a storefronts row for the user who started the flow', async () => {
    const state = await startFlow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'real-ebay-access-token', refresh_token: 'real-ebay-refresh-token', expires_in: 7200 })),
    );

    const res = await SELF.fetch(`https://worker.example.com/oauth/ebay/callback?code=auth-code-1&state=${state}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('eBay connected');

    const db = createDb(env.DB);
    const [storefront] = await db.select().from(storefronts).where(eq(storefronts.userId, USER_ID));
    expect(storefront?.platform).toBe('ebay');
    expect(storefront?.oauthAccessTokenRef).toMatch(/^enc:v1:/);
    expect(await decryptCredential(env, storefront!.oauthAccessTokenRef!)).toBe('real-ebay-access-token');
    expect(await decryptCredential(env, storefront!.oauthRefreshTokenRef!)).toBe('real-ebay-refresh-token');

    // state is single-use
    const [consumedState] = await db.select().from(oauthConnectStates).where(eq(oauthConnectStates.state, state));
    expect(consumedState).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it('updates the existing storefront on a reconnect rather than creating a duplicate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'token-1', refresh_token: 'refresh-1', expires_in: 7200 })),
    );
    const state1 = await startFlow();
    await SELF.fetch(`https://worker.example.com/oauth/ebay/callback?code=code-1&state=${state1}`);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ access_token: 'token-2', refresh_token: 'refresh-2', expires_in: 7200 })),
    );
    const state2 = await startFlow();
    await SELF.fetch(`https://worker.example.com/oauth/ebay/callback?code=code-2&state=${state2}`);

    const db = createDb(env.DB);
    const rows = await db.select().from(storefronts).where(eq(storefronts.userId, USER_ID));
    expect(rows).toHaveLength(1);
    expect(await decryptCredential(env, rows[0]!.oauthAccessTokenRef!)).toBe('token-2');

    vi.unstubAllGlobals();
  });

  it('rejects a reused or unknown state', async () => {
    const res = await SELF.fetch('https://worker.example.com/oauth/ebay/callback?code=x&state=never-existed');
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain('connection failed');
  });

  it('rejects an expired state', async () => {
    const db = createDb(env.DB);
    await db.insert(oauthConnectStates).values({ state: 'old-state', userId: USER_ID, provider: 'ebay', createdAt: 0 });

    const res = await SELF.fetch('https://worker.example.com/oauth/ebay/callback?code=x&state=old-state');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/connections/cj', () => {
  it('exchanges the raw apiKey for a derived access token, encrypts it, and creates a suppliers row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ result: true, message: 'Success', data: { accessToken: 'derived-cj-token' } })),
    );

    const res = await SELF.fetch('https://worker.example.com/api/connections/cj', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ apiKey: 'CJUserNum@api@raw-dashboard-key' }),
    });
    expect(res.status).toBe(201);

    const db = createDb(env.DB);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(supplier?.provider).toBe('cj');
    expect(supplier?.apiKeyRef).toMatch(/^enc:v1:/);
    expect(await decryptCredential(env, supplier!.apiKeyRef)).toBe('derived-cj-token');

    vi.unstubAllGlobals();
  });

  it('does not store the raw apiKey anywhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ result: true, data: { accessToken: 'derived-token-2' } })),
    );

    await SELF.fetch('https://worker.example.com/api/connections/cj', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ apiKey: 'CJUserNum@api@super-secret-raw-key' }),
    });

    const db = createDb(env.DB);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(supplier?.apiKeyRef).not.toContain('super-secret-raw-key');

    vi.unstubAllGlobals();
  });

  it('updates the existing CJ supplier on reconnect rather than duplicating', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ result: true, data: { accessToken: 'token-1' } })));
    await SELF.fetch('https://worker.example.com/api/connections/cj', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ apiKey: 'key-1' }),
    });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ result: true, data: { accessToken: 'token-2' } })));
    await SELF.fetch('https://worker.example.com/api/connections/cj', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ apiKey: 'key-2' }),
    });

    const db = createDb(env.DB);
    const rows = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(rows).toHaveLength(1);
    expect(await decryptCredential(env, rows[0]!.apiKeyRef)).toBe('token-2');

    vi.unstubAllGlobals();
  });

  it('rejects with the CJ error message when the exchange fails (e.g. an invalid key)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ result: false, message: 'Invalid apiKey' })));

    const res = await SELF.fetch('https://worker.example.com/api/connections/cj', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ apiKey: 'bad-key' }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('Invalid apiKey');

    vi.unstubAllGlobals();
  });

  it('400s on a missing apiKey', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/connections/cj', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/connections/manual', () => {
  it('creates an Amazon Retail manual supplier with no credentials collected', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/connections/manual', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ provider: 'amazon_retail' }),
    });
    expect(res.status).toBe(201);

    const db = createDb(env.DB);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(supplier?.provider).toBe('amazon_retail');
    expect(supplier?.kind).toBe('manual');
    expect(supplier?.parserId).toBe('amazon-retail-manual-v1');
  });

  it('creates a Temu manual supplier using the generic "manual" provider bucket (no dedicated enum value)', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/connections/manual', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ provider: 'temu' }),
    });
    expect(res.status).toBe(201);

    const db = createDb(env.DB);
    const [supplier] = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(supplier?.provider).toBe('manual');
    expect(supplier?.name).toBe('Temu (Manual)');
    expect(supplier?.parserId).toBe('generic-fallback-v1');
  });

  it('is idempotent: connecting the same manual provider twice does not create a duplicate row', async () => {
    await SELF.fetch('https://worker.example.com/api/connections/manual', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ provider: 'temu' }),
    });
    await SELF.fetch('https://worker.example.com/api/connections/manual', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ provider: 'temu' }),
    });

    const db = createDb(env.DB);
    const rows = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(rows).toHaveLength(1);
  });

  it('allows both Amazon Retail and Temu to coexist for the same user without colliding on the shared "manual" provider bucket', async () => {
    await SELF.fetch('https://worker.example.com/api/connections/manual', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ provider: 'amazon_retail' }),
    });
    await SELF.fetch('https://worker.example.com/api/connections/manual', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ provider: 'temu' }),
    });

    const db = createDb(env.DB);
    const rows = await db.select().from(suppliers).where(eq(suppliers.userId, USER_ID));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(['Amazon Retail (Manual)', 'Temu (Manual)']);
  });

  it('400s on an unknown provider', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/connections/manual', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ provider: 'shein' }),
    });
    expect(res.status).toBe(400);
  });
});
