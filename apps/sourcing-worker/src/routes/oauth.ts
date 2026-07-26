import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, ebayConnections } from '@sourcing/db';
import { createEbayListingClient } from '@fulfillment-tracker/adapters/ebayListing';
import type { Env } from '../env.js';
import { now } from '../lib/id.js';
import { encryptCredential } from '../lib/credentialCrypto.js';
import { verifyOauthState } from '../lib/oauthState.js';

const app = new Hono<{ Bindings: Env }>();

// On success we bounce the browser back into the SPA (/connections) so the user
// isn't stranded on a dead "close this tab" page. Same-origin, so their Clerk
// session is intact when they land. On failure we stay put and show the reason.
function resultPage(ok: boolean, detail?: string): string {
  const returnTo = '/connections';
  const head = ok
    ? `<meta http-equiv="refresh" content="2;url=${returnTo}">`
    : '';
  const body = ok
    ? `<p>Taking you back to the app…</p><p style="color:#64748b;font-size:.9rem">If nothing happens, <a href="${returnTo}">click here to return</a>.</p>`
    : `<p>${detail ?? 'Please try connecting again.'}</p><p><a href="${returnTo}">Back to the app</a></p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>eBay ${ok ? 'connected' : 'connection failed'}</title>${head}</head>
<body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">
<h1>${ok ? 'eBay connected' : 'eBay connection failed'}</h1>
${body}
${ok ? `<script>setTimeout(function(){location.replace(${JSON.stringify(returnTo)})},1500)</script>` : ''}
</body></html>`;
}

// Unauthenticated provider redirect — the initiating user is recovered from
// the encrypted `state` param (see lib/oauthState.ts), not a session.
app.get('/ebay/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.html(resultPage(false, 'Missing code or state in the redirect.'), 400);

  const userId = await verifyOauthState(c.env, state);
  if (!userId) return c.html(resultPage(false, 'This connection link expired or was already used — try again.'), 400);

  if (!c.env.EBAY_CLIENT_ID || !c.env.EBAY_CLIENT_SECRET || !c.env.EBAY_RUNAME) {
    return c.html(resultPage(false, 'eBay OAuth is not configured on this deployment yet.'), 503);
  }

  const basicAuth = btoa(`${c.env.EBAY_CLIENT_ID}:${c.env.EBAY_CLIENT_SECRET}`);
  const tokenRes = await fetch(`${c.env.EBAY_API_BASE_URL ?? 'https://api.ebay.com'}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: c.env.EBAY_RUNAME }),
  });
  if (!tokenRes.ok) return c.html(resultPage(false, `eBay rejected the authorization: ${tokenRes.status}`), 502);
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

  const [encAccess, encRefresh] = await Promise.all([
    encryptCredential(c.env, tokenJson.access_token),
    encryptCredential(c.env, tokenJson.refresh_token),
  ]);
  const expiresAt = now() + tokenJson.expires_in * 1000;

  // Capture the seller's eBay username now, so an account-deletion
  // notification later can find and purge their data. Best-effort — a failure
  // here must not block the connection itself.
  let ebayUsername: string | null = null;
  try {
    ebayUsername = (await createEbayListingClient(c.env).getUserInfo(tokenJson.access_token)).username;
  } catch (err) {
    console.error('[oauth/ebay] GetUser failed (non-fatal):', err);
  }

  const db = createDb(c.env.SOURCING_DB);
  const [existing] = await db.select().from(ebayConnections).where(eq(ebayConnections.userId, userId));
  if (existing) {
    await db
      .update(ebayConnections)
      .set({ oauthAccessTokenRef: encAccess, oauthRefreshTokenRef: encRefresh, oauthExpiresAt: expiresAt, ebayUsername })
      .where(eq(ebayConnections.userId, userId));
  } else {
    await db.insert(ebayConnections).values({
      userId,
      oauthAccessTokenRef: encAccess,
      oauthRefreshTokenRef: encRefresh,
      oauthExpiresAt: expiresAt,
      ebayUsername,
      createdAt: now(),
    });
  }

  return c.html(resultPage(true));
});

export default app;
