import type { WorkflowStep } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
  createDb,
  fulfillmentLineItems,
  fulfillments,
  orderLineItems,
  orders,
  settings,
  storefronts,
  suppliers,
  type Database,
} from '@fulfillment-tracker/db';
import { evaluateMargin } from '@fulfillment-tracker/core';
import { createSupplierClient } from '@fulfillment-tracker/adapters/suppliers';
import { createShopifyClient } from '@fulfillment-tracker/adapters/shopify';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { draftDispute } from '../lib/draftDispute.js';
import type { TrackingReceivedEvent } from './types.js';

const MAX_TRACKING_TIMEOUT_RETRIES = 3; // initial wait + up to 2 more, per spec section 7 step 4
const TRACKING_TIMEOUT: `${number} days` = '7 days';

export interface OrderWorkflowParams {
  step: WorkflowStep;
  env: Env;
  orderId: string;
  forceApprove?: boolean;
}

/**
 * The full order lifecycle (spec section 7), factored out of the
 * WorkflowEntrypoint class so it can be unit-tested by passing a fake `step`
 * object (mocking `.do` / `.waitForEvent`) against a real D1 test database,
 * instead of needing the actual Workflows binding.
 */
export async function runOrderWorkflow({ step, env, orderId, forceApprove }: OrderWorkflowParams): Promise<void> {
  const db = createDb(env.DB);

  const evaluation = await step.do('evaluate-margin', async () =>
    evaluateMarginStep(db, env, orderId, forceApprove ?? false),
  );
  if (!evaluation.meetsThreshold) {
    return; // order already marked 'rejected' inside evaluateMarginStep
  }

  const fulfillmentOrderId = await step.do('fetch-fulfillment-order', async () =>
    fetchFulfillmentOrderStep(db, env, orderId),
  );

  let fulfillmentId = await step.do('place-supplier-order', async () =>
    placeSupplierOrderStep(db, env, orderId, evaluation.supplierId, evaluation.supplierCostCents),
  );

  let complete = false;
  while (!complete) {
    const tracking = await awaitTrackingForFulfillment(step, env, db, orderId, fulfillmentId);
    if (!tracking) {
      return; // exhausted retries; order stays 'exception' with an open dispute
    }

    await step.do(`push-fulfillment:${fulfillmentId}`, async () =>
      pushFulfillmentStep(db, env, orderId, fulfillmentId, fulfillmentOrderId, tracking),
    );

    complete = await step.do(`check-complete:${fulfillmentId}`, async () =>
      checkCompleteStep(db, orderId),
    );

    if (!complete) {
      fulfillmentId = await step.do(`next-shell:${fulfillmentId}`, async () =>
        createNextFulfillmentShell(db, orderId, evaluation.supplierId),
      );
    }
  }

  await awaitDeliveryForFulfillment(step, env, db, fulfillmentId);
}

// --- evaluate-margin ---------------------------------------------------

export interface EvaluateMarginResult {
  meetsThreshold: boolean;
  supplierId: string;
  supplierCostCents: number;
}

export async function evaluateMarginStep(
  db: Database,
  env: Env,
  orderId: string,
  forceApprove = false,
): Promise<EvaluateMarginResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`Order ${orderId} not found`);

  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, order.storefrontId));
  if (!storefront) throw new Error(`Storefront ${order.storefrontId} not found`);

  const [userSettings] = await db.select().from(settings).where(eq(settings.userId, storefront.userId));
  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.userId, storefront.userId))
    .orderBy(suppliers.createdAt)
    .limit(1);
  if (!supplier) throw new Error(`No active supplier configured for user ${storefront.userId}`);

  const supplierClient = createSupplierClient(env);
  let supplierCostCents = 0;
  for (const li of lineItems) {
    const quote = await supplierClient.getPrice(supplier.apiBaseUrl, li.sku, li.quantity);
    supplierCostCents += quote.costCents;
  }

  const margin = evaluateMargin({
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    supplierCostCents,
    minMarginCents: userSettings?.minMarginCents ?? 200,
    marginMode: userSettings?.marginMode ?? 'absolute',
    minMarginPercent: userSettings?.minMarginPercent ?? 10,
  });
  const meetsThreshold = margin.meetsThreshold || forceApprove;

  await db
    .update(orders)
    .set({
      marginCents: margin.marginCents,
      status: meetsThreshold ? 'evaluating' : 'rejected',
      updatedAt: now(),
    })
    .where(eq(orders.id, orderId));

  return { meetsThreshold, supplierId: supplier.id, supplierCostCents };
}

// --- fetch-fulfillment-order --------------------------------------------

export async function fetchFulfillmentOrderStep(db: Database, env: Env, orderId: string): Promise<string> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`Order ${orderId} not found`);
  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, order.storefrontId));
  if (!storefront) throw new Error(`Storefront ${order.storefrontId} not found`);
  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));

  const shopify = createShopifyClient(env);
  const lookup = await shopify.getFulfillmentOrder(
    storefront.shopDomain,
    order.externalOrderId,
    lineItems.map((li) => li.externalLineItemId),
  );

  for (const li of lineItems) {
    const fulfillmentOrderLineItemId = lookup.lineItemMap[li.externalLineItemId];
    if (fulfillmentOrderLineItemId) {
      await db
        .update(orderLineItems)
        .set({ fulfillmentOrderLineItemId })
        .where(eq(orderLineItems.id, li.id));
    }
  }

  return lookup.fulfillmentOrderId;
}

// --- place-supplier-order -----------------------------------------------

export async function placeSupplierOrderStep(
  db: Database,
  env: Env,
  orderId: string,
  supplierId: string,
  supplierCostCents: number,
): Promise<string> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`Order ${orderId} not found`);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!supplier) throw new Error(`Supplier ${supplierId} not found`);
  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));

  const supplierClient = createSupplierClient(env);
  await supplierClient.createOrder(supplier.apiBaseUrl, {
    externalOrderRef: order.externalOrderNumber,
    lineItems: lineItems.map((li) => ({ sku: li.sku, quantity: li.quantity })),
  });

  const fulfillmentId = newId();
  await db.insert(fulfillments).values({
    id: fulfillmentId,
    orderId,
    supplierId,
    costCents: supplierCostCents,
    trackingNumber: null,
    carrierDeclared: null,
    carrierDetected: null,
    carrierFinal: null,
    trackingStatus: 'pending',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: now(),
    updatedAt: now(),
  });

  await db.update(orders).set({ status: 'fulfilling', updatedAt: now() }).where(eq(orders.id, orderId));

  return fulfillmentId;
}

export async function createNextFulfillmentShell(
  db: Database,
  orderId: string,
  supplierId: string,
): Promise<string> {
  const fulfillmentId = newId();
  await db.insert(fulfillments).values({
    id: fulfillmentId,
    orderId,
    supplierId,
    costCents: null,
    trackingNumber: null,
    carrierDeclared: null,
    carrierDetected: null,
    carrierFinal: null,
    trackingStatus: 'pending',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: now(),
    updatedAt: now(),
  });
  return fulfillmentId;
}

// --- await-tracking (with timeout -> dispute -> retry) -------------------

async function awaitTrackingForFulfillment(
  step: WorkflowStep,
  env: Env,
  db: Database,
  orderId: string,
  fulfillmentId: string,
): Promise<TrackingReceivedEvent | null> {
  for (let attempt = 0; attempt < MAX_TRACKING_TIMEOUT_RETRIES; attempt++) {
    try {
      const evt = await step.waitForEvent<TrackingReceivedEvent>(`tracking-received:${fulfillmentId}:${attempt}`, {
        type: 'tracking-received',
        timeout: TRACKING_TIMEOUT,
      });
      return evt.payload;
    } catch {
      await step.do(`tracking-timeout-dispute:${fulfillmentId}:${attempt}`, async () => {
        await db.update(orders).set({ status: 'exception', updatedAt: now() }).where(eq(orders.id, orderId));
        await draftDispute(env, fulfillmentId, `No tracking number received within ${TRACKING_TIMEOUT} of label creation.`);
      });
    }
  }
  return null;
}

// --- push-fulfillment ------------------------------------------------------

export async function pushFulfillmentStep(
  db: Database,
  env: Env,
  orderId: string,
  fulfillmentId: string,
  fulfillmentOrderId: string,
  tracking: TrackingReceivedEvent,
): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`Order ${orderId} not found`);
  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, order.storefrontId));
  if (!storefront) throw new Error(`Storefront ${order.storefrontId} not found`);
  const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
  if (!fulfillment) throw new Error(`Fulfillment ${fulfillmentId} not found`);

  const allLineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const outstanding = allLineItems.filter((li) => li.quantityFulfilled < li.quantity);
  // A shipment that names a SKU covers just that line item; otherwise it's
  // assumed to be a single-box shipment covering everything still outstanding.
  const covered = tracking.sku ? outstanding.filter((li) => li.sku === tracking.sku) : outstanding;

  if (covered.length === 0) return;

  const shopify = createShopifyClient(env);
  await shopify.createFulfillment(storefront.shopDomain, {
    fulfillmentOrderId,
    trackingNumber: fulfillment.trackingNumber ?? tracking.trackingNumber,
    trackingCompany: fulfillment.carrierFinal ?? tracking.carrierDeclared ?? 'UNKNOWN',
    lineItems: covered
      .filter((li) => li.fulfillmentOrderLineItemId)
      .map((li) => ({
        fulfillmentOrderLineItemId: li.fulfillmentOrderLineItemId as string,
        quantity: li.quantity - li.quantityFulfilled,
      })),
  });

  for (const li of covered) {
    await db
      .update(orderLineItems)
      .set({ quantityFulfilled: li.quantity })
      .where(eq(orderLineItems.id, li.id));
    await db.insert(fulfillmentLineItems).values({
      id: newId(),
      fulfillmentId,
      orderLineItemId: li.id,
      quantity: li.quantity - li.quantityFulfilled,
    });
  }

  await db
    .update(fulfillments)
    .set({ pushedToStorefront: 1, updatedAt: now() })
    .where(eq(fulfillments.id, fulfillmentId));
}

// --- check-complete ----------------------------------------------------

export async function checkCompleteStep(db: Database, orderId: string): Promise<boolean> {
  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const complete = lineItems.every((li) => li.quantityFulfilled >= li.quantity);
  await db
    .update(orders)
    .set({ status: complete ? 'shipped' : 'partially_shipped', updatedAt: now() })
    .where(eq(orders.id, orderId));
  return complete;
}

// --- await-delivery ------------------------------------------------------

async function awaitDeliveryForFulfillment(
  step: WorkflowStep,
  env: Env,
  db: Database,
  fulfillmentId: string,
): Promise<void> {
  try {
    const evt = await step.waitForEvent<{ fulfillmentId: string; status: 'in_transit' | 'delivered' | 'exception' }>(
      `tracking-status:${fulfillmentId}`,
      { type: 'tracking-status', timeout: '30 days' },
    );
    await step.do(`apply-delivery-status:${fulfillmentId}`, async () => {
      await db
        .update(fulfillments)
        .set({ trackingStatus: evt.payload.status, updatedAt: now() })
        .where(eq(fulfillments.id, fulfillmentId));

      if (evt.payload.status === 'delivered') {
        const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
        if (fulfillment) {
          await db.update(orders).set({ status: 'delivered', updatedAt: now() }).where(eq(orders.id, fulfillment.orderId));
        }
      } else if (evt.payload.status === 'exception') {
        const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
        if (fulfillment) {
          await db.update(orders).set({ status: 'exception', updatedAt: now() }).where(eq(orders.id, fulfillment.orderId));
        }
        await draftDispute(env, fulfillmentId, 'Carrier reported a delivery exception.');
      }
    });
  } catch {
    // No delivery confirmation within the window; leave as-is for manual review.
  }
}

