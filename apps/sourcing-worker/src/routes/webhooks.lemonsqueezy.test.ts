import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, creditAccounts, users } from '@sourcing/db';
import { eq } from 'drizzle-orm';

const SECRET = 'test-ls-webhook-secret'; // matches vitest.config.ts
const BASE = 'https://sourcing.example.com/webhooks/lemonsqueezy';

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.delete(creditAccounts);
  await db.insert(users).values({ id: 'usr_ls', clerkUserId: 'clerk_ls', email: 'ls@test.dev', createdAt: 0 }).onConflictDoNothing();
  await db.insert(creditAccounts).values({ userId: 'usr_ls', balance: 10, createdAt: 0, updatedAt: 0 }).onConflictDoNothing();
});

describe('POST /webhooks/lemonsqueezy', () => {
  it('rejects a bad signature', async () => {
    const body = JSON.stringify({ meta: { event_name: 'order_created', custom_data: { user_id: 'usr_ls' } } });
    const res = await SELF.fetch(BASE, { method: 'POST', headers: { 'X-Signature': 'deadbeef' }, body });
    expect(res.status).toBe(401);
  });

  it('grants credits on a signed order_created for a credit pack', async () => {
    const body = JSON.stringify({
      meta: { event_name: 'order_created', custom_data: { user_id: 'usr_ls', kind: 'credits', credits: '200', offering_id: 'credits_200' } },
    });
    const res = await SELF.fetch(BASE, { method: 'POST', headers: { 'X-Signature': await sign(SECRET, body) }, body });
    expect(res.status).toBe(200);

    const db = createDb(env.SOURCING_DB);
    const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, 'usr_ls'));
    expect(acct!.balance).toBe(210); // 10 + 200
  });

  it('activates a subscription on subscription_created', async () => {
    const body = JSON.stringify({
      meta: { event_name: 'subscription_created', custom_data: { user_id: 'usr_ls', kind: 'subscription', plan: 'pro' } },
      data: { attributes: { status: 'active', renews_at: '2026-09-01T00:00:00.000000Z' } },
    });
    const res = await SELF.fetch(BASE, { method: 'POST', headers: { 'X-Signature': await sign(SECRET, body) }, body });
    expect(res.status).toBe(200);

    const db = createDb(env.SOURCING_DB);
    const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, 'usr_ls'));
    expect(acct!.plan).toBe('pro');
    expect(acct!.subscriptionStatus).toBe('active');
  });
});
