import { Hono } from 'hono';
import { verifyHmacSha256 } from '@fulfillment-tracker/adapters/hmac';
import { createDb, orders, orderLineItems, storefronts, webhookEvents } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { resolveSecretRef } from '../lib/secretRef.js';

interface ShopifyOrderPayload {
  id: number;
  admin_graphql_api_id: string;
  name: string;
  currency: string;
  subtotal_price: string;
  total_shipping_price_set?: { shop_money: { amount: string } };
  line_items: {
    id: number;
    admin_graphql_api_id: string;
    sku: string;
    title: string;
    quantity: number;
    price: string;
  }[];
}

function centsFromDecimalString(value: string | undefined): number {
  if (!value) return 0;
  return Math.round(Number.parseFloat(value) * 100);
}

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /webhooks/shopify — HMAC-verified, deduplicated, and trivially fast:
 * it only persists the raw event + order shell and enqueues the rest. All
 * slow work happens in OrderWorkflow, never here.
 */
app.post('/', async (c) => {
  const rawBody = await c.req.text();
  const hmacHeader = c.req.header('X-Shopify-Hmac-Sha256');
  const webhookId = c.req.header('X-Shopify-Webhook-Id');
  const shopDomain = c.req.header('X-Shopify-Shop-Domain');

  if (!hmacHeader || !webhookId || !shopDomain) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing required Shopify headers' } }, 400);
  }

  const db = createDb(c.env.DB);
  const [storefront] = await db
    .select()
    .from(storefronts)
    .where(eq(storefronts.shopDomain, shopDomain))
    .limit(1);

  if (!storefront) {
    return c.json({ error: { code: 'UNKNOWN_STOREFRONT', message: 'No storefront registered for this shop' } }, 404);
  }

  // Storefront secrets are resolved via *_ref pointers; in this single-tenant
  // dev/demo setup the ref is a literal `env:VAR_NAME` pointing at a process
  // env var (see .dev.vars.example and DECISIONS.md).
  const webhookSecret = resolveSecretRef(storefront.webhookSecretRef, c.env);
  const valid = await verifyHmacSha256(webhookSecret, rawBody, hmacHeader);
  if (!valid) {
    return c.json({ error: { code: 'INVALID_SIGNATURE', message: 'HMAC verification failed' } }, 401);
  }

  const [existing] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(eq(webhookEvents.dedupKey, webhookId))
    .limit(1);
  if (existing) {
    return c.json({ ok: true, deduped: true });
  }

  const payload = JSON.parse(rawBody) as ShopifyOrderPayload;
  const webhookEventId = newId();
  const orderId = newId();
  const timestamp = now();

  try {
    await db.batch([
      db.insert(webhookEvents).values({
        id: webhookEventId,
        source: 'shopify',
        dedupKey: webhookId,
        rawBody,
        headersJson: JSON.stringify(Object.fromEntries(c.req.raw.headers)),
        processed: 1,
        error: null,
        receivedAt: timestamp,
      }),
      db.insert(orders).values({
        id: orderId,
        storefrontId: storefront.id,
        externalOrderId: payload.admin_graphql_api_id,
        externalOrderNumber: payload.name,
        status: 'received',
        currency: payload.currency,
        subtotalCents: centsFromDecimalString(payload.subtotal_price),
        shippingCents: centsFromDecimalString(payload.total_shipping_price_set?.shop_money.amount),
        marginCents: null,
        rawPayloadId: webhookEventId,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      ...payload.line_items.map((li) =>
        db.insert(orderLineItems).values({
          id: newId(),
          orderId,
          externalLineItemId: li.admin_graphql_api_id,
          fulfillmentOrderLineItemId: null,
          sku: li.sku,
          title: li.title,
          quantity: li.quantity,
          quantityFulfilled: 0,
          unitPriceCents: centsFromDecimalString(li.price),
        }),
      ),
    ]);
  } catch (err) {
    // UNIQUE(storefront_id, external_order_id) conflict: order already exists
    // from a prior delivery of a differently-ided webhook. Treat as handled.
    if (isUniqueConstraintError(err)) {
      return c.json({ ok: true, deduped: true });
    }
    throw err;
  }

  await c.env.ORDER_QUEUE.send({ orderId });

  return c.json({ ok: true, orderId });
});

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export default app;
