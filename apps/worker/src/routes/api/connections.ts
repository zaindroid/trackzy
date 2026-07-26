import { Hono } from 'hono';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { createDb, oauthConnectStates, suppliers } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';
import { encryptCredential } from '../../lib/credentialCrypto.js';

/**
 * Authenticated "start" endpoints for the multi-tenant self-serve connect
 * flows (see DECISIONS.md) — each generates a one-time `state` value tying
 * the redirect back to the logged-in user, then returns the provider's
 * consent-screen URL as JSON (not a raw HTTP redirect) for the dashboard to
 * navigate to itself. A raw redirect wouldn't work here: these endpoints
 * require a Bearer token (this app's whole auth model — no session
 * cookies), and a plain browser navigation to a URL can't attach an
 * Authorization header the way `fetch()` can. The corresponding
 * unauthenticated `/oauth/:provider/callback` handlers (routes/oauth.ts) are
 * where the `state` gets consumed and the actual token exchange happens,
 * since a provider's redirect back to us can't carry a bearer token either.
 */
const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

async function createState(env: Env, userId: string, provider: 'ebay' | 'aliexpress'): Promise<string> {
  const db = createDb(env.DB);
  const state = crypto.randomUUID();
  await db.insert(oauthConnectStates).values({ state, userId, provider, createdAt: now() });
  return state;
}

app.get('/ebay/start', async (c) => {
  if (!c.env.EBAY_CLIENT_ID || !c.env.EBAY_RUNAME) {
    return errorResponse(c, 'NOT_CONFIGURED', 'eBay OAuth is not configured on this deployment yet', 503);
  }
  const state = await createState(c.env, c.get('userId'), 'ebay');
  const consentUrl = new URL('https://auth.ebay.com/oauth2/authorize');
  consentUrl.searchParams.set('client_id', c.env.EBAY_CLIENT_ID);
  consentUrl.searchParams.set('redirect_uri', c.env.EBAY_RUNAME); // eBay's "RuName" — a registered identifier, not a literal URL
  consentUrl.searchParams.set('response_type', 'code');
  consentUrl.searchParams.set(
    'scope',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory',
  );
  consentUrl.searchParams.set('state', state);
  return c.json({ redirectUrl: consentUrl.toString() });
});

app.get('/aliexpress/start', async (c) => {
  if (!c.env.ALIEXPRESS_APP_KEY) {
    return errorResponse(c, 'NOT_CONFIGURED', 'AliExpress OAuth is not configured on this deployment yet', 503);
  }
  const state = await createState(c.env, c.get('userId'), 'aliexpress');
  const redirectUri = `${new URL(c.req.url).origin}/oauth/aliexpress/callback`;
  const consentUrl = new URL('https://api-sg.aliexpress.com/oauth/authorize'); // see DEPLOY.md section 11
  consentUrl.searchParams.set('response_type', 'code');
  consentUrl.searchParams.set('client_id', c.env.ALIEXPRESS_APP_KEY);
  consentUrl.searchParams.set('redirect_uri', redirectUri);
  consentUrl.searchParams.set('sp', 'ae');
  consentUrl.searchParams.set('view', 'web');
  consentUrl.searchParams.set('state', state);
  return c.json({ redirectUrl: consentUrl.toString() });
});

const cjConnectSchema = z.object({ apiKey: z.string().min(1) });

/**
 * CJ Dropshipping isn't OAuth — the user's raw dashboard `apiKey` gets
 * exchanged once, server-side, for the actual bearer credential
 * (`POST /authentication/getAccessToken`, confirmed shape per
 * packages/adapters/src/supplierApi/cj/real.ts's own doc comment; ~6-month
 * validity, no auto-refresh machinery needed the way eBay/AliExpress do —
 * see DECISIONS.md). No redirect needed, so this is a plain authed POST
 * rather than a start/callback pair.
 *
 * TODO(HUMAN): the exact `data.accessToken` field name below matches CJ's
 * publicly documented response envelope but hasn't been exercised against a
 * live account — confirm once a real customer connects (or you test with
 * your own key) and fix the field name here if it differs.
 */
app.post('/cj', async (c) => {
  const parsed = cjConnectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }

  const baseUrl = c.env.CJ_BASE_URL ?? 'https://developers.cjdropshipping.com/api2.0/v1';
  const exchangeRes = await fetch(`${baseUrl}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: parsed.data.apiKey }),
  });
  if (!exchangeRes.ok) {
    return errorResponse(c, 'EXCHANGE_FAILED', `CJ Dropshipping rejected this API key: ${exchangeRes.status}`, 502);
  }
  const exchangeJson = (await exchangeRes.json()) as { result: boolean; message?: string; data?: { accessToken?: string } };
  if (!exchangeJson.result || !exchangeJson.data?.accessToken) {
    return errorResponse(c, 'EXCHANGE_FAILED', exchangeJson.message ?? 'CJ Dropshipping did not return an access token', 502);
  }

  const encryptedToken = await encryptCredential(c.env, exchangeJson.data.accessToken);
  const db = createDb(c.env.DB);
  const userId = c.get('userId');
  const [existing] = await db.select().from(suppliers).where(and(eq(suppliers.userId, userId), eq(suppliers.provider, 'cj')));

  if (existing) {
    await db.update(suppliers).set({ apiKeyRef: encryptedToken, active: 1 }).where(eq(suppliers.id, existing.id));
    return c.json({ id: existing.id });
  }

  const id = newId();
  await db.insert(suppliers).values({
    id,
    userId,
    name: 'CJ Dropshipping',
    apiBaseUrl: baseUrl,
    apiKeyRef: encryptedToken,
    emailSenderPattern: '@cjdropshipping.com',
    parserId: 'generic-fallback-v1',
    kind: 'api',
    provider: 'cj',
    active: 1,
    createdAt: now(),
  });
  return c.json({ id }, 201);
});

const manualConnectSchema = z.object({ provider: z.enum(['amazon_retail', 'temu']) });

// `suppliers.provider`'s CHECK constraint doesn't have a 'temu' value, and
// widening it would mean the same risky drop+recreate rebuild documented in
// DECISIONS.md's "Platform CHECK constraint" entry (suppliers has FK
// dependents too: manual_tasks/fulfillments/listings/supplier_offers). The
// schema already has a generic `'manual'` bucket for exactly this shape (no
// dedicated integration, Buy-Queue only) — Temu reuses that instead of
// adding a new enum value. Distinguished from any other manual supplier by
// `name`, not `provider`, in the "already connected" lookup below.
const MANUAL_PROVIDER_CONFIG: Record<
  'amazon_retail' | 'temu',
  { name: string; apiBaseUrl: string; emailSenderPattern: string; parserId: string; dbProvider: 'amazon_retail' | 'manual' }
> = {
  amazon_retail: {
    name: 'Amazon Retail (Manual)',
    apiBaseUrl: 'https://www.amazon.com',
    emailSenderPattern: '@amazon.com',
    parserId: 'amazon-retail-manual-v1',
    dbProvider: 'amazon_retail',
  },
  temu: {
    name: 'Temu (Manual)',
    apiBaseUrl: 'https://www.temu.com',
    emailSenderPattern: '@temu.com',
    parserId: 'generic-fallback-v1',
    dbProvider: 'manual',
  },
};

/**
 * Amazon Retail and Temu need no credentials at all — both are manual/
 * Buy-Queue suppliers (a human places the order, the extension pastes the
 * buyer's address; see checkout.ts), so "connecting" one is just creating
 * the `suppliers` row that makes it show up in the Buy Queue. Amazon
 * Business API (the real automated ordering API) deliberately isn't
 * exposed here — it requires each customer's own private agreement with
 * Amazon and can't be self-served (confirmed in DECISIONS.md).
 */
app.post('/manual', async (c) => {
  const parsed = manualConnectSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const config = MANUAL_PROVIDER_CONFIG[parsed.data.provider];
  const db = createDb(c.env.DB);
  const userId = c.get('userId');
  const [existing] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.userId, userId), eq(suppliers.name, config.name)));
  if (existing) {
    return c.json({ id: existing.id });
  }

  const id = newId();
  await db.insert(suppliers).values({
    id,
    userId,
    name: config.name,
    apiBaseUrl: config.apiBaseUrl,
    apiKeyRef: 'PLACEHOLDER__NO_API_KEY_MANUAL_SUPPLIER',
    emailSenderPattern: config.emailSenderPattern,
    parserId: config.parserId,
    kind: 'manual',
    provider: config.dbProvider,
    active: 1,
    createdAt: now(),
  });
  return c.json({ id }, 201);
});

export default app;
