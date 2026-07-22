import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { computeHmacSha256Base64 } from '@fulfillment-tracker/adapters/hmac';
import { createDb, orderLineItems, orders, storefronts, users, webhookEvents } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import singleItemOrder from '../../../../fixtures/shopify/order-single-item.json';
import multiItemOrder from '../../../../fixtures/shopify/order-multi-item.json';

const SHOP_DOMAIN = 'demo-store.myshopify.com';
// Must match the SHOPIFY_WEBHOOK_SECRET binding configured in vitest.config.ts.
const WEBHOOK_SECRET = 'test-shopify-webhook-secret';

async function seedStorefront() {
  const db = createDb(env.DB);
  const userId = 'usr_test';
  const storefrontId = 'sf_test';
  await db.insert(users).values({ id: userId, clerkUserId: 'dev-user', email: 'demo@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: storefrontId,
    userId,
    platform: 'shopify',
    shopDomain: SHOP_DOMAIN,
    accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
    webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  return storefrontId;
}

async function postWebhook(body: unknown, opts: { webhookId: string; badSignature?: boolean }) {
  const rawBody = JSON.stringify(body);
  const signature = opts.badSignature
    ? 'invalid-signature=='
    : await computeHmacSha256Base64(WEBHOOK_SECRET, rawBody);
  return SELF.fetch('https://worker.example.com/webhooks/shopify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Hmac-Sha256': signature,
      'X-Shopify-Webhook-Id': opts.webhookId,
      'X-Shopify-Shop-Domain': SHOP_DOMAIN,
    },
    body: rawBody,
  });
}

beforeEach(async () => {
  await seedStorefront();
});

describe('POST /webhooks/shopify', () => {
  it('rejects a request with an invalid HMAC signature', async () => {
    const res = await postWebhook(singleItemOrder, { webhookId: 'wh-1', badSignature: true });
    expect(res.status).toBe(401);
  });

  it('accepts a validly-signed order and persists order + line items', async () => {
    const res = await postWebhook(singleItemOrder, { webhookId: 'wh-2' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; orderId: string };
    expect(body.ok).toBe(true);

    const db = createDb(env.DB);
    const [order] = await db.select().from(orders).where(eq(orders.id, body.orderId));
    expect(order?.externalOrderNumber).toBe('#1101');
    expect(order?.subtotalCents).toBe(4450);
    expect(order?.shippingCents).toBe(599);
    expect(order?.status).toBe('received');
  });

  it('persists every line item for a multi-line-item order', async () => {
    const res = await postWebhook(multiItemOrder, { webhookId: 'wh-3' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { orderId: string };

    const db = createDb(env.DB);
    const items = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, body.orderId));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.sku).sort()).toEqual(['GIZMO-GREEN-S', 'WIDGET-RED-L']);
  });

  it('is idempotent under duplicate webhook delivery (same webhook id twice -> one order)', async () => {
    const first = await postWebhook(singleItemOrder, { webhookId: 'wh-dup' });
    const second = await postWebhook(singleItemOrder, { webhookId: 'wh-dup' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { deduped?: boolean };
    expect(secondBody.deduped).toBe(true);

    const db = createDb(env.DB);
    const matches = await db
      .select()
      .from(orders)
      .where(eq(orders.externalOrderId, singleItemOrder.admin_graphql_api_id));
    expect(matches).toHaveLength(1);

    const events = await db.select().from(webhookEvents).where(eq(webhookEvents.dedupKey, 'wh-dup'));
    expect(events).toHaveLength(1);
  });

  it('returns 404 for a shop domain with no registered storefront', async () => {
    const rawBody = JSON.stringify(singleItemOrder);
    const signature = await computeHmacSha256Base64(WEBHOOK_SECRET, rawBody);
    const res = await SELF.fetch('https://worker.example.com/webhooks/shopify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Hmac-Sha256': signature,
        'X-Shopify-Webhook-Id': 'wh-unknown-shop',
        'X-Shopify-Shop-Domain': 'unregistered-shop.myshopify.com',
      },
      body: rawBody,
    });
    expect(res.status).toBe(404);
  });
});
