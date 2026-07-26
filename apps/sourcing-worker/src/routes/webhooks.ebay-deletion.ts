import { Hono } from 'hono';
import { eq, or } from 'drizzle-orm';
import { createDb, ebayConnections } from '@sourcing/db';
import type { Env } from '../env.js';

const app = new Hono<{ Bindings: Env }>();

interface EbayDeletionPayload {
  notification?: {
    data?: {
      username?: string;
      userId?: string;
    };
  };
}

/**
 * eBay's Marketplace Account Deletion/Closure notification — mandatory for a
 * Production keyset (eBay disables the keyset until it's wired up). Zearch
 * genuinely processes eBay member data (it stores the seller's OAuth token
 * and acts on their store), so the exemption doesn't apply — same posture as
 * trackzy's own handler.
 *
 * GET is eBay's one-time endpoint-ownership challenge:
 * {"challengeResponse": sha256Hex(challengeCode + verificationToken + endpointUrl)}.
 *
 * POST is the real notification: when an eBay member closes their account we
 * purge their stored connection. Matches on BOTH username and immutable
 * userId (eBay is migrating usernames -> immutable user IDs and sends both).
 * Acks 200 fast and never throws — eBay retries on non-200/timeout.
 */
app.get('/', async (c) => {
  const challengeCode = c.req.query('challenge_code');
  const verificationToken = c.env.EBAY_DELETION_VERIFICATION_TOKEN;
  if (!challengeCode || !verificationToken) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing challenge_code or verification token not configured' } }, 400);
  }
  const url = new URL(c.req.url);
  const endpoint = `${url.origin}${url.pathname}`;
  return c.json({ challengeResponse: await sha256Hex(challengeCode + verificationToken + endpoint) });
});

app.post('/', async (c) => {
  const payload = await c.req.json<EbayDeletionPayload>().catch(() => null);
  const username = payload?.notification?.data?.username;
  const userId = payload?.notification?.data?.userId;

  if (username || userId) {
    const db = createDb(c.env.SOURCING_DB);
    const matchers = [
      ...(username ? [eq(ebayConnections.ebayUsername, username)] : []),
      ...(userId ? [eq(ebayConnections.ebayUserId, userId)] : []),
    ];
    // Deleting the connection row purges the seller's stored eBay OAuth
    // tokens. Their research/candidate data isn't eBay member PII (it's public
    // product/market data + our own generated content), so it's left intact.
    await db.delete(ebayConnections).where(matchers.length === 1 ? matchers[0]! : or(...matchers));
  }

  return c.json({ ok: true });
});

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default app;
