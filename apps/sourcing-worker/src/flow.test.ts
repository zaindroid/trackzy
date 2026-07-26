import { describe, expect, it, beforeEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, ebayConnections, productCandidates, users } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import { encryptCredential } from './lib/credentialCrypto.js';
import { now } from './lib/id.js';

const AUTH = { Authorization: 'Bearer dev-user-sourcing', 'Content-Type': 'application/json' };
const USER_ID = 'usr_sourcing';

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-sourcing', email: 'sourcing@test.dev', createdAt: 0 });
});

describe('auth', () => {
  it('401s without a bearer token', async () => {
    const res = await SELF.fetch('https://s.example.com/api/connections/status');
    expect(res.status).toBe(401);
  });
});

describe('connections', () => {
  it('reports both providers disconnected initially, then CJ connected after a successful key exchange', async () => {
    const before = await SELF.fetch('https://s.example.com/api/connections/status', { headers: AUTH });
    expect(await before.json()).toEqual({ ebayConnected: false, cjConnected: false, aliexpressAvailable: true });

    // CJ's getAccessToken is a real fetch (not adapter-gated) — stub it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ result: true, data: { accessToken: 'cj-access-token' } }), { status: 200 })),
    );
    const connect = await SELF.fetch('https://s.example.com/api/connections/cj', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ apiKey: 'CJ-RAW-KEY' }),
    });
    expect(connect.status).toBe(201);
    vi.unstubAllGlobals();

    const after = await SELF.fetch('https://s.example.com/api/connections/status', { headers: AUTH });
    expect(await after.json()).toEqual({ ebayConnected: false, cjConnected: true, aliexpressAvailable: true });
  });

  it('returns an eBay consent URL carrying an encrypted state', async () => {
    const res = await SELF.fetch('https://s.example.com/api/connections/ebay/start', { headers: AUTH });
    expect(res.status).toBe(200);
    const { redirectUrl } = (await res.json()) as { redirectUrl: string };
    const url = new URL(redirectUrl);
    expect(url.hostname).toBe('auth.ebay.com');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('sell.inventory');
  });
});

describe('settings', () => {
  it('creates defaults on first GET and persists updates', async () => {
    const first = await SELF.fetch('https://s.example.com/api/settings', { headers: AUTH });
    const { settings } = (await first.json()) as { settings: { ebayFeePercent: number; targetMarginPercent: number } };
    expect(settings.ebayFeePercent).toBe(13.25);

    const updated = await SELF.fetch('https://s.example.com/api/settings', {
      method: 'PUT',
      headers: AUTH,
      body: JSON.stringify({ targetMarginPercent: 40, itemLocationPostalCode: '90210' }),
    });
    const body = (await updated.json()) as { settings: { targetMarginPercent: number; itemLocationPostalCode: string } };
    expect(body.settings.targetMarginPercent).toBe(40);
    expect(body.settings.itemLocationPostalCode).toBe('90210');
  });
});

async function connectCj() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ result: true, data: { accessToken: 'cj-access-token' } }), { status: 200 })));
  await SELF.fetch('https://s.example.com/api/connections/cj', { method: 'POST', headers: AUTH, body: JSON.stringify({ apiKey: 'CJ-RAW-KEY' }) });
  vi.unstubAllGlobals();
}

describe('research pipeline (mock adapters)', () => {
  interface Candidate {
    keyword: string;
    supplierProvider: string;
    supplierCostCents: number;
    suggestedSellPriceCents: number;
    marginCents: number;
    generatedTitle: string;
    supplierImageUrls: string[];
    status: string;
  }

  it('defaults to AliExpress (no connection needed) and produces ranked, list-ready candidates with real margin math', async () => {
    const res = await SELF.fetch('https://s.example.com/api/product-research/research', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ seed: 'silk eye mask' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; candidates: Candidate[] };
    expect(body.candidates.length).toBeGreaterThan(0);
    const c0 = body.candidates[0]!;
    expect(c0.supplierProvider).toBe('aliexpress');
    expect(c0.suggestedSellPriceCents).toBeGreaterThan(0);
    expect(c0.supplierCostCents).toBeGreaterThan(0);
    expect(c0.generatedTitle).toBeTruthy();
    expect(c0.status).toBe('draft');
    for (let i = 1; i < body.candidates.length; i++) {
      expect(body.candidates[i - 1]!.marginCents).toBeGreaterThanOrEqual(body.candidates[i]!.marginCents);
    }
  });

  it('sources from CJ when explicitly chosen and connected', async () => {
    await connectCj();
    const res = await SELF.fetch('https://s.example.com/api/product-research/research', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ seed: 'silk eye mask', supplier: 'cj' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: Candidate[] };
    expect(body.candidates[0]?.supplierProvider).toBe('cj');
  });

  it('refuses a CJ research when CJ is not connected (but AliExpress would still work)', async () => {
    const res = await SELF.fetch('https://s.example.com/api/product-research/research', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ seed: 'phone case', supplier: 'cj' }),
    });
    expect(res.status).toBe(502);
  });
});

describe('one-click list', () => {
  it('publishes a draft to eBay (mock) and marks it listed with an item id', async () => {
    await connectCj();
    // Seed an eBay connection (encrypted token, far-future expiry so no refresh).
    const db = createDb(env.SOURCING_DB);
    await db.insert(ebayConnections).values({
      userId: USER_ID,
      oauthAccessTokenRef: await encryptCredential(env, 'fake-ebay-token'),
      oauthRefreshTokenRef: await encryptCredential(env, 'fake-ebay-refresh'),
      oauthExpiresAt: now() + 3600_000,
      createdAt: 0,
    });

    // Produce a candidate to list.
    const research = await SELF.fetch('https://s.example.com/api/product-research/research', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ seed: 'silk eye mask' }),
    });
    const { candidates } = (await research.json()) as { candidates: { id: string }[] };
    const candidateId = candidates[0]!.id;

    const listed = await SELF.fetch(`https://s.example.com/api/candidates/${candidateId}/list`, { method: 'POST', headers: AUTH });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { ebayItemId: string; sku: string };
    expect(body.ebayItemId).toMatch(/^MOCK-/);

    const [row] = await db.select().from(productCandidates).where(eq(productCandidates.id, candidateId));
    expect(row?.status).toBe('listed');
    expect(row?.ebayItemId).toBe(body.ebayItemId);

    // A second click is rejected, not re-listed.
    const again = await SELF.fetch(`https://s.example.com/api/candidates/${candidateId}/list`, { method: 'POST', headers: AUTH });
    expect(again.status).toBe(409);
  });

  it('refuses to list when eBay is not connected', async () => {
    await connectCj();
    const research = await SELF.fetch('https://s.example.com/api/product-research/research', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ seed: 'silk eye mask' }),
    });
    const { candidates } = (await research.json()) as { candidates: { id: string }[] };
    const res = await SELF.fetch(`https://s.example.com/api/candidates/${candidates[0]!.id}/list`, { method: 'POST', headers: AUTH });
    expect(res.status).toBe(400);
  });
});
