import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { provisionUser } from './auth.js';

function clerkUserJson(id: string, email: string) {
  return {
    id,
    primary_email_address_id: 'idn_1',
    email_addresses: [{ id: 'idn_1', email_address: email, verification: null, linked_to: [] }],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('provisionUser (auto-provisioning a brand-new Clerk sign-up)', () => {
  it('creates a users row using the email fetched from Clerk\'s Backend API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toContain('clerk_user_new_1');
        return jsonResponse(clerkUserJson('clerk_user_new_1', 'new-customer@example.com'));
      }),
    );

    const db = createDb(env.DB);
    const user = await provisionUser(db, env, 'clerk_user_new_1');

    expect(user.clerkUserId).toBe('clerk_user_new_1');
    expect(user.email).toBe('new-customer@example.com');

    const [row] = await db.select().from(users).where(eq(users.clerkUserId, 'clerk_user_new_1'));
    expect(row?.id).toBe(user.id);

    vi.unstubAllGlobals();
  });

  it('falls back to a placeholder email rather than failing when Clerk\'s API call errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'not found' }, 404)));

    const db = createDb(env.DB);
    const user = await provisionUser(db, env, 'clerk_user_new_2');

    expect(user.email).toBe('clerk_user_new_2@unknown.clerk.user');

    vi.unstubAllGlobals();
  });

  it('is race-safe: a duplicate concurrent provision attempt for the same clerkUserId returns the existing row instead of erroring', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(clerkUserJson('clerk_user_new_3', 'race@example.com'))),
    );

    const db = createDb(env.DB);
    const [first, second] = await Promise.all([
      provisionUser(db, env, 'clerk_user_new_3'),
      provisionUser(db, env, 'clerk_user_new_3'),
    ]);

    expect(first.id).toBe(second.id); // same row, not two different users for the same Clerk identity

    const rows = await db.select().from(users).where(eq(users.clerkUserId, 'clerk_user_new_3'));
    expect(rows).toHaveLength(1);

    vi.unstubAllGlobals();
  });
});
