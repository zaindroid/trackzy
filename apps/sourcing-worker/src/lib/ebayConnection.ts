import { ebayConnections, type Database } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { decryptCredential, encryptCredential } from './credentialCrypto.js';
import { now } from './id.js';

const REFRESH_MARGIN_MS = 5 * 60_000;
const SELL_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.inventory';

/**
 * Returns a fresh eBay OAuth access token for the user, transparently
 * refreshing (and persisting the new token + expiry) when it's within 5
 * minutes of expiry. Returns `null` when the user hasn't connected eBay yet.
 * The sourcing worker owns eBay token lifecycle here rather than pushing it
 * into the adapter, so the `ebayListing` adapter can stay a stateless
 * "give me a token, I'll make the call" client.
 */
export async function getFreshEbayToken(env: Env, db: Database, userId: string): Promise<string | null> {
  const [conn] = await db.select().from(ebayConnections).where(eq(ebayConnections.userId, userId));
  if (!conn) return null;

  const accessToken = await decryptCredential(env, conn.oauthAccessTokenRef);
  if (conn.oauthExpiresAt - REFRESH_MARGIN_MS > now()) return accessToken;

  const refreshToken = await decryptCredential(env, conn.oauthRefreshTokenRef);
  const basicAuth = btoa(`${env.EBAY_CLIENT_ID ?? ''}:${env.EBAY_CLIENT_SECRET ?? ''}`);
  const res = await fetch(`${env.EBAY_API_BASE_URL ?? 'https://api.ebay.com'}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: SELL_SCOPE }),
  });
  if (!res.ok) {
    throw new Error(`eBay token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  const freshExpiry = now() + json.expires_in * 1000;
  await db
    .update(ebayConnections)
    .set({ oauthAccessTokenRef: await encryptCredential(env, json.access_token), oauthExpiresAt: freshExpiry })
    .where(eq(ebayConnections.userId, userId));
  return json.access_token;
}
