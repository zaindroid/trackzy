import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, creditAccounts, productCandidates, users, winners, winnerUnlocks } from '@sourcing/db';
import { eq } from 'drizzle-orm';

const BASE = 'https://sourcing.example.com/api/library';
const AUTH = { Authorization: 'Bearer lib-user' }; // mock verifier maps token -> clerkUserId

function winnerRow(over: Record<string, unknown> = {}) {
  const ts = Date.now(); // fresh → no re-score network call
  return {
    id: 'win_1',
    normalizedKey: 'grinder nail dog',
    keyword: 'dog nail grinder',
    productTitle: 'Rechargeable Dog Nail Grinder',
    imageUrlsJson: JSON.stringify(['https://img/1.jpg']),
    supplierProvider: 'aliexpress',
    supplierProductId: 'AE1',
    supplierCostCents: 500,
    supplierProductUrl: 'https://www.aliexpress.com/item/1.html',
    ebaySoldCount: 300,
    ebayMedianPriceCents: 1899,
    marginCents: 1150,
    marginPercent: 60,
    score: 88,
    generatedTitle: 'Rechargeable Dog Nail Grinder — Quiet, Cordless',
    generatedDescription: '<p>nice</p>',
    generatedAspectsJson: JSON.stringify({ Brand: 'Unbranded' }),
    reserved: 0,
    timesUnlocked: 0,
    lastScoredAt: ts,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  };
}

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.delete(winnerUnlocks);
  await db.delete(winners);
  await db.delete(productCandidates);
  await db.delete(creditAccounts);
  // In mock mode the auth middleware doesn't auto-provision, so seed the user
  // (Bearer token maps to clerkUserId). Trial credits are granted on first hit.
  await db.insert(users).values({ id: 'usr_lib', clerkUserId: 'lib-user', email: 'lib@test.dev', createdAt: 0 }).onConflictDoNothing();
});

async function makePro(db: ReturnType<typeof createDb>) {
  await SELF.fetch(BASE, { headers: AUTH }); // provision + trial grant
  await db.update(creditAccounts).set({ plan: 'pro', subscriptionStatus: 'active' }).where(eq(creditAccounts.userId, 'usr_lib'));
}

describe('Golden Products (winners library)', () => {
  it('is gated: non-Pro users get access:false and no winners', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(winners).values(winnerRow());
    const res = await SELF.fetch(BASE, { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access: boolean; winners: unknown[] };
    expect(body.access).toBe(false);
    expect(body.winners).toHaveLength(0);
  });

  it('for Pro: lists REDACTED teasers (no full title, no supplier link)', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(winners).values(winnerRow());
    await makePro(db);
    const res = await SELF.fetch(BASE, { headers: AUTH });
    const body = (await res.json()) as { access: boolean; winners: { productTitle: string; blurred: boolean; unlocked: boolean }[] };
    expect(body.access).toBe(true);
    expect(body.winners).toHaveLength(1);
    expect(body.winners[0]!.productTitle).toContain('••'); // redacted, not the full title
    expect(body.winners[0]!.productTitle).not.toContain('Grinder');
    expect(body.winners[0]!.blurred).toBe(true);
    expect(body.winners[0]).not.toHaveProperty('supplierProductUrl');
  });

  it('unlocks a fresh winner: charges a credit, copies a draft, reveals supplier', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(winners).values(winnerRow());
    // Trigger provisioning + trial grant first.
    await SELF.fetch(BASE, { headers: AUTH });
    const [before] = await db.select().from(creditAccounts);

    const res = await SELF.fetch(`${BASE}/win_1/unlock`, { method: 'POST', headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { supplierProductUrl: string; candidateId: string };
    expect(body.supplierProductUrl).toBe('https://www.aliexpress.com/item/1.html');

    const [after] = await db.select().from(creditAccounts);
    expect(after!.balance).toBe(before!.balance - 1); // charged 1 credit

    const drafts = await db.select().from(productCandidates).where(eq(productCandidates.status, 'draft'));
    expect(drafts.length).toBeGreaterThanOrEqual(1); // list-ready draft created
  });

  it('does not double-charge when unlocking again', async () => {
    const db = createDb(env.SOURCING_DB);
    await db.insert(winners).values(winnerRow());
    await SELF.fetch(BASE, { headers: AUTH });
    await SELF.fetch(`${BASE}/win_1/unlock`, { method: 'POST', headers: AUTH });
    const [mid] = await db.select().from(creditAccounts);
    await SELF.fetch(`${BASE}/win_1/unlock`, { method: 'POST', headers: AUTH });
    const [after] = await db.select().from(creditAccounts);
    expect(after!.balance).toBe(mid!.balance); // second unlock free
  });
});
