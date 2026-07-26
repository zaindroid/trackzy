import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { createDb, ebayConnections, supplierConnections } from '@sourcing/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';
import { encryptCredential } from '../../lib/credentialCrypto.js';
import { signOauthState } from '../../lib/oauthState.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const SELL_SCOPE = 'https://api.ebay.com/oauth/api_scope/sell.inventory';

// Returns the eBay consent URL as JSON (not a redirect) — the dashboard
// navigates to it. Same reasoning as trackzy: an authed endpoint can't be
// reached by a plain browser navigation carrying a bearer token.
app.get('/ebay/start', async (c) => {
  if (!c.env.EBAY_CLIENT_ID || !c.env.EBAY_RUNAME) {
    return errorResponse(c, 'NOT_CONFIGURED', 'eBay OAuth is not configured on this deployment yet', 503);
  }
  const state = await signOauthState(c.env, c.get('userId'));
  const url = new URL('https://auth.ebay.com/oauth2/authorize');
  url.searchParams.set('client_id', c.env.EBAY_CLIENT_ID);
  url.searchParams.set('redirect_uri', c.env.EBAY_RUNAME);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SELL_SCOPE);
  url.searchParams.set('state', state);
  return c.json({ redirectUrl: url.toString() });
});

const cjSchema = z.object({ apiKey: z.string().min(1) });

app.post('/cj', async (c) => {
  const parsed = cjSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);

  const baseUrl = c.env.CJ_BASE_URL ?? 'https://developers.cjdropshipping.com/api2.0/v1';
  const exchangeRes = await fetch(`${baseUrl}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: parsed.data.apiKey }),
  });
  if (!exchangeRes.ok) {
    return errorResponse(c, 'EXCHANGE_FAILED', `CJ Dropshipping rejected this API key: ${exchangeRes.status}`, 502);
  }
  const json = (await exchangeRes.json()) as { result: boolean; message?: string; data?: { accessToken?: string } };
  if (!json.result || !json.data?.accessToken) {
    return errorResponse(c, 'EXCHANGE_FAILED', json.message ?? 'CJ Dropshipping did not return an access token', 502);
  }

  const encrypted = await encryptCredential(c.env, json.data.accessToken);
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const [existing] = await db
    .select()
    .from(supplierConnections)
    .where(and(eq(supplierConnections.userId, userId), eq(supplierConnections.provider, 'cj')));

  if (existing) {
    await db.update(supplierConnections).set({ apiKeyRef: encrypted, apiBaseUrl: baseUrl }).where(eq(supplierConnections.id, existing.id));
    return c.json({ ok: true });
  }
  await db.insert(supplierConnections).values({
    id: newId(),
    userId,
    provider: 'cj',
    apiKeyRef: encrypted,
    apiBaseUrl: baseUrl,
    createdAt: now(),
  });
  return c.json({ ok: true }, 201);
});

app.get('/status', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const [ebay] = await db.select().from(ebayConnections).where(eq(ebayConnections.userId, userId));
  const [cj] = await db
    .select()
    .from(supplierConnections)
    .where(and(eq(supplierConnections.userId, userId), eq(supplierConnections.provider, 'cj')));
  // AliExpress needs no connection — it's searched via the app-level Apify
  // token (public data), so it's always available as a sourcing supplier.
  return c.json({ ebayConnected: Boolean(ebay), cjConnected: Boolean(cj), aliexpressAvailable: true });
});

export default app;
