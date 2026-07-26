import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  fulfillments,
  listings,
  manualTasks,
  orderLineItems,
  orders,
  settings,
  storefronts,
  supplierOffers,
  suppliers,
  users,
} from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import type { OrderSourceOrder } from '@fulfillment-tracker/adapters/orderSource';
import { ingestMarketplaceOrder, pollMarketplaceOrders } from './marketplaceSync.js';

const USER_ID = 'usr_mps_test';
const STOREFRONT_ID = 'sf_mps_test';
const MANUAL_SUPPLIER_ID = 'sup_mps_manual';
const API_SUPPLIER_ID = 'sup_mps_api';

function fixtureOrder(overrides: Partial<OrderSourceOrder> = {}): OrderSourceOrder {
  return {
    externalOrderId: 'ebay-order-mps-1',
    externalOrderNumber: '#EB-MPS-1',
    currency: 'USD',
    subtotalCents: 5000,
    shippingCents: 500,
    lineItems: [{ externalLineItemId: 'ext-li-mps-1', sku: 'TEMU-GADGET', title: 'Temu Gadget', quantity: 1, unitPriceCents: 5000 }],
    buyerName: 'ebay_buyer_1',
    shipTo: { name: 'Jordan Buyer', address1: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', zip: '62704', country: 'US' },
    ...overrides,
  };
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-mps', email: 'mps@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'ebay-store-mps',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_CLIENT_SECRET',
    oauthAccessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    oauthRefreshTokenRef: 'env:EBAY_OAUTH_REFRESH_TOKEN',
    oauthExpiresAt: Date.now() + 3600_000,
    createdAt: 0,
  });
  await db.insert(suppliers).values([
    {
      id: MANUAL_SUPPLIER_ID,
      userId: USER_ID,
      name: 'Temu',
      apiBaseUrl: '',
      apiKeyRef: 'env:SUPPLIER_API_KEY',
      emailSenderPattern: '@temu.com',
      parserId: 'temu-v1',
      kind: 'manual',
      provider: 'manual',
      active: 1,
      createdAt: 0,
    },
    {
      id: API_SUPPLIER_ID,
      userId: USER_ID,
      name: 'CJ Dropshipping',
      apiBaseUrl: 'https://api.cjdropshipping.example.com',
      apiKeyRef: 'env:CJ_API_KEY',
      emailSenderPattern: '@cjdropshipping.example.com',
      parserId: 'cj-v1',
      kind: 'api',
      provider: 'cj',
      active: 1,
      createdAt: 0,
    },
  ]);
  await db.insert(settings).values({ userId: USER_ID, minMarginCents: 200, marginMode: 'absolute', minMarginPercent: 10, autoFulfill: 1 });
});

async function addListing(sku: string, supplierId: string, costCents: number, externalListingId = `ext-listing-${sku}`) {
  const db = createDb(env.DB);
  const listingId = `listing_${sku}`;
  await db.insert(listings).values({
    id: listingId,
    storefrontId: STOREFRONT_ID,
    externalListingId,
    sku,
    title: sku,
    priceCents: 5000,
    quantityAvailable: 10,
    supplierId,
    supplierProductId: `supplier-product-${sku}`,
    matchConfidence: 1,
    matchSource: 'exact_sku',
    autoReprice: 1,
    autoPause: 1,
    status: 'active',
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(supplierOffers).values({
    id: `offer_${sku}`,
    listingId,
    supplierId,
    supplierProductId: `supplier-product-${sku}`,
    costCents,
    shippingCents: 0,
    inStock: 1,
    shipDays: 5,
    score: 1,
    checkedAt: 0,
  });
}

describe('ingestMarketplaceOrder', () => {
  it('creates orders/order_line_items and a manual_tasks row (with shipTo) for a matched manual supplier that clears margin', async () => {
    await addListing('TEMU-GADGET', MANUAL_SUPPLIER_ID, 1000); // cost 1000 vs subtotal 5000 clears margin
    const db = createDb(env.DB);

    await ingestMarketplaceOrder(db, env, STOREFRONT_ID, USER_ID, fixtureOrder());

    const [order] = await db.select().from(orders).where(eq(orders.externalOrderId, 'ebay-order-mps-1'));
    expect(order?.status).toBe('fulfilling');
    expect(order?.marginCents).toBe(5000 - 1000 - 500);

    const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, order!.id));
    expect(lineItems).toHaveLength(1);
    expect(lineItems[0]?.sku).toBe('TEMU-GADGET');

    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.orderId, order!.id));
    expect(fulfillment?.supplierId).toBe(MANUAL_SUPPLIER_ID);
    expect(fulfillment?.costCents).toBe(1000);

    const [task] = await db.select().from(manualTasks).where(eq(manualTasks.orderId, order!.id));
    expect(task?.state).toBe('pending');
    const payload = JSON.parse(task!.payloadJson);
    expect(payload.shipTo.name).toBe('Jordan Buyer');
    expect(payload.buyerName).toBe('ebay_buyer_1');
  });

  it('marks the order rejected when supplier cost leaves insufficient margin, and does not place any supplier order', async () => {
    await addListing('TEMU-GADGET', MANUAL_SUPPLIER_ID, 4900); // cost 4900 + shipping 500 > subtotal 5000
    const db = createDb(env.DB);

    await ingestMarketplaceOrder(db, env, STOREFRONT_ID, USER_ID, fixtureOrder());

    const [order] = await db.select().from(orders).where(eq(orders.externalOrderId, 'ebay-order-mps-1'));
    expect(order?.status).toBe('rejected');

    const tasks = await db.select().from(manualTasks).where(eq(manualTasks.orderId, order!.id));
    expect(tasks).toHaveLength(0);
  });

  it('marks the order exception when a line item SKU has no matched listing', async () => {
    // no listing/offer inserted for TEMU-GADGET
    const db = createDb(env.DB);

    await ingestMarketplaceOrder(db, env, STOREFRONT_ID, USER_ID, fixtureOrder());

    const [order] = await db.select().from(orders).where(eq(orders.externalOrderId, 'ebay-order-mps-1'));
    expect(order?.status).toBe('exception');

    const tasks = await db.select().from(manualTasks).where(eq(manualTasks.orderId, order!.id));
    expect(tasks).toHaveLength(0);
  });

  it('is idempotent: ingesting the same externalOrderId twice does not create a duplicate order', async () => {
    await addListing('TEMU-GADGET', MANUAL_SUPPLIER_ID, 1000);
    const db = createDb(env.DB);

    await ingestMarketplaceOrder(db, env, STOREFRONT_ID, USER_ID, fixtureOrder());
    await ingestMarketplaceOrder(db, env, STOREFRONT_ID, USER_ID, fixtureOrder());

    const matching = await db.select().from(orders).where(eq(orders.externalOrderId, 'ebay-order-mps-1'));
    expect(matching).toHaveLength(1);
  });

  it('groups line items by supplier into separate fulfillments/manual_tasks for a multi-supplier order', async () => {
    await addListing('TEMU-GADGET', MANUAL_SUPPLIER_ID, 1000);
    await addListing('CJ-WIDGET', API_SUPPLIER_ID, 500);
    const db = createDb(env.DB);

    await ingestMarketplaceOrder(
      db,
      env,
      STOREFRONT_ID,
      USER_ID,
      fixtureOrder({
        subtotalCents: 8000,
        lineItems: [
          { externalLineItemId: 'ext-li-a', sku: 'TEMU-GADGET', title: 'Temu Gadget', quantity: 1, unitPriceCents: 5000 },
          { externalLineItemId: 'ext-li-b', sku: 'CJ-WIDGET', title: 'CJ Widget', quantity: 1, unitPriceCents: 3000 },
        ],
      }),
    );

    const [order] = await db.select().from(orders).where(eq(orders.externalOrderId, 'ebay-order-mps-1'));
    expect(order?.status).toBe('fulfilling');

    const createdFulfillments = await db.select().from(fulfillments).where(eq(fulfillments.orderId, order!.id));
    expect(createdFulfillments).toHaveLength(2);
    expect(createdFulfillments.map((f) => f.supplierId).sort()).toEqual([API_SUPPLIER_ID, MANUAL_SUPPLIER_ID].sort());

    const tasks = await db.select().from(manualTasks).where(eq(manualTasks.orderId, order!.id));
    expect(tasks).toHaveLength(1); // only the manual supplier gets a manual_tasks row
  });
});

describe('pollMarketplaceOrders', () => {
  it('ingests the mock eBay fixture order end-to-end and advances lastPolledAt', async () => {
    // externalListingId matches the mock eBay adapter's FIXTURE_LISTINGS entry exactly, so the
    // listings-sync step this test now also exercises (see catalog/listingsSync.ts) recognizes
    // this as the same listing and updates it in place rather than inserting a second, unmatched
    // row for the same SKU.
    await addListing('WIDGET-RED-L', MANUAL_SUPPLIER_ID, 1000, 'ebay-mock-listing-1');
    const db = createDb(env.DB);

    await pollMarketplaceOrders(env);

    const [order] = await db.select().from(orders).where(eq(orders.externalOrderId, 'ebay-mock-16-11635-28233'));
    expect(order).toBeDefined();
    expect(order?.status).toBe('fulfilling');

    const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, STOREFRONT_ID));
    expect(storefront?.lastPolledAt).toBeGreaterThan(0);
  });

  it('skips storefronts with no OAuth configured', async () => {
    const db = createDb(env.DB);
    await db.update(storefronts).set({ oauthAccessTokenRef: null, oauthRefreshTokenRef: null }).where(eq(storefronts.id, STOREFRONT_ID));

    await expect(pollMarketplaceOrders(env)).resolves.not.toThrow();
    const orderRows = await db.select().from(orders);
    expect(orderRows).toHaveLength(0);
  });
});
