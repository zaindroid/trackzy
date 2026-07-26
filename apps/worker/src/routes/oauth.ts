import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { createDb, oauthConnectStates, storefronts, suppliers } from '@fulfillment-tracker/db';
import { signAliExpressParams } from '@fulfillment-tracker/adapters/supplierApi';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { encryptCredential } from '../lib/credentialCrypto.js';
import { createOrderSourceForStorefront } from '../lib/orderSourceForStorefront.js';
import { syncListingsForStorefront } from '../catalog/listingsSync.js';

/**
 * Unauthenticated OAuth callback landing pages — a provider's redirect back
 * to us after user consent can't carry a bearer token, so these routes
 * instead recover "which of our users started this" from the one-time
 * `state` value created by the matching authed `/api/connections/:provider/start`
 * endpoint (routes/api/connections.ts). See DECISIONS.md for the full
 * multi-tenant connection design.
 */
const app = new Hono<{ Bindings: Env }>();

const STATE_TTL_MS = 15 * 60 * 1000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

function connectResultPage(providerLabel: string, ok: boolean, detail?: string) {
  return `<!doctype html><html><body style="font-family: system-ui, sans-serif; padding: 2rem; text-align: center;">
    <h2>${ok ? `✅ ${providerLabel} connected` : `❌ ${providerLabel} connection failed`}</h2>
    ${detail ? `<p style="color:#666;">${escapeHtml(detail)}</p>` : ''}
    <p><a href="/connections">Return to Connections</a></p>
  </body></html>`;
}

/**
 * Validates + consumes (deletes) a one-time connect state. Returns null and
 * has already emitted the failure page's data via the returned `error` flag
 * when the state is missing/reused/expired/for-the-wrong-provider — the
 * caller still owns rendering the actual HTML response since the provider
 * label differs per route.
 */
async function consumeState(
  c: { env: Env },
  provider: 'ebay' | 'aliexpress',
  state: string | undefined,
): Promise<{ userId: string } | null> {
  if (!state) return null;
  const db = createDb(c.env.DB);
  const [stateRow] = await db.select().from(oauthConnectStates).where(eq(oauthConnectStates.state, state));
  if (stateRow) {
    await db.delete(oauthConnectStates).where(eq(oauthConnectStates.state, state)); // single-use, regardless of outcome
  }
  if (!stateRow || stateRow.provider !== provider || now() - stateRow.createdAt > STATE_TTL_MS) {
    return null;
  }
  return { userId: stateRow.userId };
}

app.get('/aliexpress/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.html(connectResultPage('AliExpress', false, 'Missing code or state in the redirect.'), 400);
  }

  const consumed = await consumeState(c, 'aliexpress', state);
  if (!consumed) {
    return c.html(connectResultPage('AliExpress', false, 'This connection link expired or was already used — try connecting again.'), 400);
  }

  if (!c.env.ALIEXPRESS_APP_KEY || !c.env.ALIEXPRESS_APP_SECRET) {
    return c.html(connectResultPage('AliExpress', false, 'AliExpress OAuth is not configured on this deployment yet.'), 503);
  }

  const path = '/auth/token/create';
  const restAuthBaseUrl = c.env.ALIEXPRESS_REST_BASE_URL ?? 'https://api-sg.aliexpress.com/rest';
  const params: Record<string, string> = {
    app_key: c.env.ALIEXPRESS_APP_KEY,
    timestamp: String(now()),
    sign_method: 'sha256',
    code,
  };
  const sign = await signAliExpressParams(params, c.env.ALIEXPRESS_APP_SECRET, path);
  const qs = new URLSearchParams({ ...params, sign });
  const tokenRes = await fetch(`${restAuthBaseUrl}${path}?${qs.toString()}`, { method: 'GET' });
  if (!tokenRes.ok) {
    return c.html(connectResultPage('AliExpress', false, `AliExpress rejected the authorization: ${tokenRes.status}`), 502);
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expire_time: number;
    code?: string;
    message?: string;
  };
  if (tokenJson.code && tokenJson.code !== '0') {
    return c.html(connectResultPage('AliExpress', false, `AliExpress rejected the authorization: ${tokenJson.code} ${tokenJson.message ?? ''}`), 502);
  }

  const [encryptedAccess, encryptedRefresh] = await Promise.all([
    encryptCredential(c.env, tokenJson.access_token),
    encryptCredential(c.env, tokenJson.refresh_token),
  ]);

  const db = createDb(c.env.DB);
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.userId, consumed.userId), eq(suppliers.provider, 'aliexpress')));

  if (existing) {
    await db
      .update(suppliers)
      .set({ oauthAccessTokenRef: encryptedAccess, oauthRefreshTokenRef: encryptedRefresh, oauthExpiresAt: tokenJson.expire_time })
      .where(eq(suppliers.id, existing.id));
  } else {
    await db.insert(suppliers).values({
      id: newId(),
      userId: consumed.userId,
      name: 'AliExpress',
      apiBaseUrl: 'https://api-sg.aliexpress.com/sync',
      apiKeyRef: 'PLACEHOLDER__NOT_APPLICABLE_ALIEXPRESS_SUPPLIER', // AliExpress uses oauth*Ref below, not a static key
      emailSenderPattern: '@aliexpress.com',
      parserId: 'aliexpress-v1',
      kind: 'api',
      provider: 'aliexpress',
      active: 1,
      oauthAccessTokenRef: encryptedAccess,
      oauthRefreshTokenRef: encryptedRefresh,
      oauthExpiresAt: tokenJson.expire_time,
      createdAt: now(),
    });
  }

  return c.html(connectResultPage('AliExpress', true));
});

app.get('/ebay/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.html(connectResultPage('eBay', false, 'Missing code or state in the redirect.'), 400);
  }

  const consumed = await consumeState(c, 'ebay', state);
  if (!consumed) {
    return c.html(connectResultPage('eBay', false, 'This connection link expired or was already used — try connecting again.'), 400);
  }

  if (!c.env.EBAY_CLIENT_ID || !c.env.EBAY_CLIENT_SECRET || !c.env.EBAY_RUNAME) {
    return c.html(connectResultPage('eBay', false, 'eBay OAuth is not configured on this deployment yet.'), 503);
  }

  const basicAuth = btoa(`${c.env.EBAY_CLIENT_ID}:${c.env.EBAY_CLIENT_SECRET}`);
  const tokenRes = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: c.env.EBAY_RUNAME }),
  });
  if (!tokenRes.ok) {
    return c.html(connectResultPage('eBay', false, `eBay rejected the authorization: ${tokenRes.status}`), 502);
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number };

  const [encryptedAccess, encryptedRefresh] = await Promise.all([
    encryptCredential(c.env, tokenJson.access_token),
    encryptCredential(c.env, tokenJson.refresh_token),
  ]);
  const oauthExpiresAt = now() + tokenJson.expires_in * 1000;

  const db = createDb(c.env.DB);
  const [existing] = await db
    .select()
    .from(storefronts)
    .where(and(eq(storefronts.userId, consumed.userId), eq(storefronts.platform, 'ebay')));

  const storefrontId = existing?.id ?? newId();
  if (existing) {
    await db
      .update(storefronts)
      .set({ oauthAccessTokenRef: encryptedAccess, oauthRefreshTokenRef: encryptedRefresh, oauthExpiresAt })
      .where(eq(storefronts.id, existing.id));
  } else {
    await db.insert(storefronts).values({
      id: storefrontId,
      userId: consumed.userId,
      platform: 'ebay',
      shopDomain: `ebay-${consumed.userId}`,
      // Shopify-shaped legacy columns, not meaningful for an eBay row — same
      // placeholder convention already used elsewhere for required-but-unused fields.
      accessTokenRef: 'PLACEHOLDER__NOT_APPLICABLE_EBAY_STOREFRONT',
      webhookSecretRef: 'PLACEHOLDER__NOT_APPLICABLE_EBAY_STOREFRONT',
      oauthAccessTokenRef: encryptedAccess,
      oauthRefreshTokenRef: encryptedRefresh,
      oauthExpiresAt,
      // Safer default until the user confirms their own Fulfillment API
      // tracking-upload capability — see DEPLOY.md section 8.
      nonApiMode: 1,
      createdAt: now(),
    });
  }

  // Best-effort immediate sync so the customer's existing listings show up
  // right away instead of waiting for the next 10-minute marketplaceSync
  // cron tick — a failure here (e.g. a large catalog timing out) doesn't
  // block the connection itself, since the cron will pick it up regardless.
  // Re-selected fresh (rather than reusing `existing`) so this always sees
  // the tokens just written above, not a stale pre-update copy.
  try {
    const [storefrontRow] = await db.select().from(storefronts).where(eq(storefronts.id, storefrontId));
    const orderSource = storefrontRow ? await createOrderSourceForStorefront(c.env, db, storefrontRow) : null;
    if (orderSource) await syncListingsForStorefront(c.env, db, storefrontId, orderSource);
  } catch (err) {
    console.error(`[oauth/ebay/callback] initial listing sync failed for storefront ${storefrontId}:`, err);
  }

  return c.html(connectResultPage('eBay', true));
});

export default app;
