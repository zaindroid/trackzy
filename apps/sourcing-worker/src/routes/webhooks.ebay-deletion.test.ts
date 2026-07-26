import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, ebayConnections, users } from '@sourcing/db';
import { eq } from 'drizzle-orm';

// Must match EBAY_DELETION_VERIFICATION_TOKEN in vitest.config.ts.
const VERIFICATION_TOKEN = 'test-verification-token-0123456789';
const ENDPOINT_URL = 'https://sourcing.example.com/webhooks/ebay-account-deletion';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.insert(users).values([
    { id: 'usr_a', clerkUserId: 'clerk_a', email: 'a@test.dev', createdAt: 0 },
    { id: 'usr_b', clerkUserId: 'clerk_b', email: 'b@test.dev', createdAt: 0 },
  ]);
  await db.insert(ebayConnections).values([
    {
      userId: 'usr_a',
      oauthAccessTokenRef: 'enc:v1:x:y',
      oauthRefreshTokenRef: 'enc:v1:x:z',
      oauthExpiresAt: 0,
      ebayUsername: 'deleteme_seller',
      ebayUserId: 'uid_deleteme',
      createdAt: 0,
    },
    {
      userId: 'usr_b',
      oauthAccessTokenRef: 'enc:v1:p:q',
      oauthRefreshTokenRef: 'enc:v1:p:r',
      oauthExpiresAt: 0,
      ebayUsername: 'other_seller',
      ebayUserId: 'uid_other',
      createdAt: 0,
    },
  ]);
});

describe('GET /webhooks/ebay-account-deletion (endpoint verification)', () => {
  it('returns sha256(challengeCode + verificationToken + endpoint) hex', async () => {
    const challengeCode = 'abc123';
    const res = await SELF.fetch(`${ENDPOINT_URL}?challenge_code=${challengeCode}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeResponse: string };
    expect(body.challengeResponse).toBe(await sha256Hex(challengeCode + VERIFICATION_TOKEN + ENDPOINT_URL));
  });

  it('400s when challenge_code is missing', async () => {
    const res = await SELF.fetch(ENDPOINT_URL);
    expect(res.status).toBe(400);
  });
});

describe('POST /webhooks/ebay-account-deletion (deletion notification)', () => {
  it('purges the connection matching the deleted username, leaving others intact', async () => {
    const res = await SELF.fetch(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification: { data: { username: 'deleteme_seller', userId: 'uid_deleteme' } } }),
    });
    expect(res.status).toBe(200);

    const db = createDb(env.SOURCING_DB);
    const deleted = await db.select().from(ebayConnections).where(eq(ebayConnections.userId, 'usr_a'));
    expect(deleted).toHaveLength(0);
    const kept = await db.select().from(ebayConnections).where(eq(ebayConnections.userId, 'usr_b'));
    expect(kept).toHaveLength(1);
  });

  it('matches on immutable userId even when the username differs', async () => {
    await SELF.fetch(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification: { data: { username: 'renamed_since', userId: 'uid_deleteme' } } }),
    });
    const db = createDb(env.SOURCING_DB);
    const deleted = await db.select().from(ebayConnections).where(eq(ebayConnections.userId, 'usr_a'));
    expect(deleted).toHaveLength(0);
  });

  it('leaves everything intact for an unknown seller', async () => {
    await SELF.fetch(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notification: { data: { username: 'nobody', userId: 'uid_nobody' } } }),
    });
    const db = createDb(env.SOURCING_DB);
    const all = await db.select().from(ebayConnections);
    expect(all).toHaveLength(2);
  });

  it('acks 200 on a malformed body, since eBay retries on non-200', async () => {
    const res = await SELF.fetch(ENDPOINT_URL, { method: 'POST', body: 'not json' });
    expect(res.status).toBe(200);
  });
});
