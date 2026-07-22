import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import type { WorkflowStep } from 'cloudflare:workers';
import {
  createDb,
  fulfillmentLineItems,
  fulfillments,
  orderLineItems,
  orders,
  settings,
  storefronts,
  suppliers,
  users,
} from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { runOrderWorkflow } from './orderLogic.js';
import type { TrackingReceivedEvent } from './types.js';

/**
 * Minimal fake WorkflowStep: `.do` invokes its callback immediately (no
 * durability/retries needed for a unit test), `.waitForEvent` pops the next
 * queued event for that event type, throwing (simulating a timeout) once the
 * queue for that type is exhausted.
 */
function createFakeStep(eventsByType: Record<string, unknown[]>): WorkflowStep {
  const queues = new Map<string, unknown[]>(Object.entries(eventsByType).map(([k, v]) => [k, [...v]]));
  return {
    async do(_name: string, cbOrConfig: unknown, maybeCb?: unknown) {
      const callback = (typeof cbOrConfig === 'function' ? cbOrConfig : maybeCb) as (ctx: unknown) => Promise<unknown>;
      return callback({ step: { name: _name, count: 0 }, attempt: 1, config: {} });
    },
    sleep: async () => undefined,
    sleepUntil: async () => undefined,
    async waitForEvent(_name: string, options: { type: string }) {
      const queue = queues.get(options.type);
      if (!queue || queue.length === 0) {
        throw new Error(`mock-timeout: no queued event for type "${options.type}"`);
      }
      return { payload: queue.shift(), timestamp: new Date(), type: options.type };
    },
  } as unknown as WorkflowStep;
}

const USER_ID = 'usr_wf_test';
const STOREFRONT_ID = 'sf_wf_test';
const SUPPLIER_ID = 'sup_wf_test';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user', email: 'd@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'shopify',
    shopDomain: 'demo-store.myshopify.com',
    accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
    webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: SUPPLIER_ID,
    userId: USER_ID,
    name: 'Acme Supply Co',
    apiBaseUrl: 'https://api.acmesupply.example.com',
    apiKeyRef: 'env:SUPPLIER_API_KEY',
    emailSenderPattern: '@acmesupply.example.com',
    parserId: 'acme-supply-v1',
    active: 1,
    createdAt: 0,
  });
  await db.insert(settings).values({
    userId: USER_ID,
    minMarginCents: 200,
    marginMode: 'absolute',
    minMarginPercent: 10,
    autoFulfill: 1,
  });
});

describe('runOrderWorkflow', () => {
  it('rejects an order whose margin is below threshold and stops before placing a supplier order', async () => {
    const db = createDb(env.DB);
    const orderId = 'ord_reject_test';
    await db.insert(orders).values({
      id: orderId,
      storefrontId: STOREFRONT_ID,
      externalOrderId: 'gid://shopify/Order/reject-1',
      externalOrderNumber: '#9201',
      status: 'received',
      currency: 'USD',
      subtotalCents: 100, // deliberately too low to clear any supplier cost + threshold
      shippingCents: 50,
      marginCents: null,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(orderLineItems).values({
      id: 'li_reject_1',
      orderId,
      externalLineItemId: 'gid://shopify/LineItem/601',
      fulfillmentOrderLineItemId: null,
      sku: 'SKU-CHEAP',
      title: 'Cheap item',
      quantity: 1,
      quantityFulfilled: 0,
      unitPriceCents: 100,
    });

    const step = createFakeStep({});
    await runOrderWorkflow({ step, env: env as unknown as Parameters<typeof runOrderWorkflow>[0]['env'], orderId });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe('rejected');
    expect(order?.marginCents).not.toBeNull();
    expect(order!.marginCents!).toBeLessThan(200);

    const createdFulfillments = await db.select().from(fulfillments).where(eq(fulfillments.orderId, orderId));
    expect(createdFulfillments).toHaveLength(0);
  });

  it('fully fulfills a multi-item order across two tracking events (split shipment)', async () => {
    const db = createDb(env.DB);
    const orderId = 'ord_split_test';
    await db.insert(orders).values({
      id: orderId,
      storefrontId: STOREFRONT_ID,
      externalOrderId: 'gid://shopify/Order/split-1',
      externalOrderNumber: '#9202',
      status: 'received',
      currency: 'USD',
      subtotalCents: 30000,
      shippingCents: 500,
      marginCents: null,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(orderLineItems).values([
      {
        id: 'li_split_a',
        orderId,
        externalLineItemId: 'gid://shopify/LineItem/701',
        fulfillmentOrderLineItemId: null,
        sku: 'SKU-A',
        title: 'Item A',
        quantity: 1,
        quantityFulfilled: 0,
        unitPriceCents: 10000,
      },
      {
        id: 'li_split_b',
        orderId,
        externalLineItemId: 'gid://shopify/LineItem/702',
        fulfillmentOrderLineItemId: null,
        sku: 'SKU-B',
        title: 'Item B',
        quantity: 2,
        quantityFulfilled: 0,
        unitPriceCents: 10000,
      },
    ]);

    const trackingEvent1: TrackingReceivedEvent = {
      fulfillmentId: 'unused-by-push-logic',
      trackingNumber: '1Z999AA10123456780',
      carrierDeclared: 'UPS',
      sku: 'SKU-A',
      source: 'regex',
    };
    const trackingEvent2: TrackingReceivedEvent = {
      fulfillmentId: 'unused-by-push-logic',
      trackingNumber: '70123456789012345674',
      carrierDeclared: 'USPS',
      source: 'regex',
    };

    const step = createFakeStep({ 'tracking-received': [trackingEvent1, trackingEvent2] });
    await runOrderWorkflow({ step, env: env as unknown as Parameters<typeof runOrderWorkflow>[0]['env'], orderId });

    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order?.status).toBe('shipped');

    const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
    const liA = lineItems.find((li) => li.sku === 'SKU-A');
    const liB = lineItems.find((li) => li.sku === 'SKU-B');
    expect(liA?.quantityFulfilled).toBe(1);
    expect(liB?.quantityFulfilled).toBe(2);

    const createdFulfillments = await db.select().from(fulfillments).where(eq(fulfillments.orderId, orderId));
    expect(createdFulfillments).toHaveLength(2);
    expect(createdFulfillments.every((f) => f.pushedToStorefront === 1)).toBe(true);

    const flItems = await db
      .select()
      .from(fulfillmentLineItems)
      .where(eq(fulfillmentLineItems.fulfillmentId, createdFulfillments[0]!.id));
    expect(flItems.length).toBeGreaterThan(0);
  });
});
