import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, listingMonitors, productCandidates, users } from '@sourcing/db';
import { eq } from 'drizzle-orm';

const AUTH = { Authorization: 'Bearer mon-user' };
const BASE = 'https://s.example.com/api/monitor';

function listedCandidate(id: string) {
  return {
    id,
    userId: 'usr_mon',
    runId: null,
    keyword: 'silicone dog lick mat',
    ebayAvgSoldPriceCents: 1899,
    ebayMedianPriceCents: 1799,
    ebaySoldCount: 300,
    supplierProvider: 'aliexpress',
    supplierProductId: 'AE-mon-1',
    supplierCostCents: 500,
    supplierProductUrl: 'https://www.aliexpress.com/item/1.html',
    supplierImageUrlsJson: JSON.stringify(['https://img/1.jpg']),
    marginCents: 1000,
    marginPercent: 55,
    opportunityScore: 90,
    suggestedSellPriceCents: 1799,
    generatedTitle: 'Silicone Dog Lick Mat',
    generatedDescription: '<p>x</p>',
    generatedAspectsJson: JSON.stringify({}),
    categoryId: null,
    status: 'listed' as const,
    ebayItemId: 'MOCK-123',
    sku: 'SRC-1',
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.delete(listingMonitors);
  await db.delete(productCandidates);
  await db.insert(users).values({ id: 'usr_mon', clerkUserId: 'mon-user', email: 'm@test.dev', createdAt: 0 }).onConflictDoNothing();
});

describe('price/stock monitor', () => {
  it('lists a user\'s monitors with health + config', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(productCandidates).values(listedCandidate('cand_mon'));
    await db.insert(listingMonitors).values({ candidateId: 'cand_mon', userId: 'usr_mon', enabled: 1, minMarginPercent: 20, currentSellPriceCents: 1799, currentSupplierCostCents: 500, createdAt: 0, updatedAt: 0 });

    const res = await SELF.fetch(BASE, { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { monitors: { candidateId: string; health: string; minMarginPercent: number }[] };
    expect(body.monitors).toHaveLength(1);
    expect(body.monitors[0]!.minMarginPercent).toBe(20);
  });

  it('updates monitor rules (floor margin, ceiling, on/off)', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(productCandidates).values(listedCandidate('cand_mon'));
    await db.insert(listingMonitors).values({ candidateId: 'cand_mon', userId: 'usr_mon', enabled: 1, minMarginPercent: 20, createdAt: 0, updatedAt: 0 });

    const res = await SELF.fetch(`${BASE}/cand_mon`, { method: 'PATCH', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ minMarginPercent: 35, priceCeilingCents: 2500, enabled: false }) });
    expect(res.status).toBe(200);
    const [m] = await db.select().from(listingMonitors).where(eq(listingMonitors.candidateId, 'cand_mon'));
    expect(m!.minMarginPercent).toBe(35);
    expect(m!.priceCeilingCents).toBe(2500);
    expect(m!.enabled).toBe(0);
  });

  it('runs a check now and records state + history', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(productCandidates).values(listedCandidate('cand_mon'));
    await db.insert(listingMonitors).values({ candidateId: 'cand_mon', userId: 'usr_mon', enabled: 1, minMarginPercent: 20, createdAt: 0, updatedAt: 0 });

    const res = await SELF.fetch(`${BASE}/cand_mon/check`, { method: 'POST', headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; action: string };
    expect(body.ok).toBe(true);
    expect(typeof body.action).toBe('string');

    const [m] = await db.select().from(listingMonitors).where(eq(listingMonitors.candidateId, 'cand_mon'));
    expect(m!.lastCheckedAt).not.toBeNull();
    expect(['healthy', 'warning', 'critical', 'paused']).toContain(m!.health);
  });
});
