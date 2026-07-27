import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, creditAccounts, creditLedger, users } from '@sourcing/db';
import { eq } from 'drizzle-orm';

const TOKEN = 'test-internal-service-token'; // matches vitest.config.ts
const URL = 'https://sourcing.example.com/internal/fulfillment-charge';

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.delete(creditLedger);
  await db.delete(creditAccounts);
  await db.insert(users).values({ id: 'usr_ff', clerkUserId: 'clerk_ff', email: 'ff@test.dev', createdAt: 0 }).onConflictDoNothing();
  await db.insert(creditAccounts).values({ userId: 'usr_ff', balance: 1, createdAt: 0, updatedAt: 0 }).onConflictDoNothing();
});

describe('POST /internal/fulfillment-charge', () => {
  it('rejects without the service token', async () => {
    const res = await SELF.fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clerkUserId: 'clerk_ff', orderId: 'o1' }) });
    expect(res.status).toBe(401);
  });

  it('charges a fulfillment credit (idempotent per order, allows debt)', async () => {
    const db = createDb(env.SOURCING_DB);
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

    const r1 = await SELF.fetch(URL, { method: 'POST', headers: hdr, body: JSON.stringify({ clerkUserId: 'clerk_ff', orderId: 'o1' }) });
    expect(r1.status).toBe(200);
    expect((await r1.json()) as { balance: number }).toMatchObject({ charged: true, balance: 0 });

    // Second order pushes the balance NEGATIVE (debt) — fulfillment never blocked.
    const r2 = await SELF.fetch(URL, { method: 'POST', headers: hdr, body: JSON.stringify({ clerkUserId: 'clerk_ff', orderId: 'o2' }) });
    expect(((await r2.json()) as { balance: number }).balance).toBe(-1);

    // Re-charging the SAME order is a no-op (idempotent).
    const r1again = await SELF.fetch(URL, { method: 'POST', headers: hdr, body: JSON.stringify({ clerkUserId: 'clerk_ff', orderId: 'o1' }) });
    expect(((await r1again.json()) as { charged: boolean }).charged).toBe(false);

    const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, 'usr_ff'));
    expect(acct!.balance).toBe(-1); // unchanged by the idempotent retry
  });
});
