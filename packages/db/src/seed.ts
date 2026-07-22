import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { monotonicFactory } from 'ulid';

/**
 * Deterministic PRNG (mulberry32) so every `pnpm db:seed` run produces byte-
 * identical IDs and SQL — required for the seed file to be diff-stable in git
 * and for the demo dataset to be reproducible.
 */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const prng = mulberry32(42);
const ulid = monotonicFactory(prng);
const BASE_TIME = Date.parse('2026-07-15T09:00:00.000Z');
let tick = 0;
function id(): string {
  return ulid(BASE_TIME + tick++ * 1000);
}
function ts(offsetMinutes: number): number {
  return BASE_TIME + offsetMinutes * 60_000;
}

function esc(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

type Row = Record<string, string | number | null>;

function insert(table: string, rows: Row[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0] as Row);
  const values = rows
    .map((row) => `  (${columns.map((c) => esc(row[c] ?? null)).join(', ')})`)
    .join(',\n');
  return `INSERT INTO ${table} (${columns.join(', ')})\nVALUES\n${values};`;
}

// ---------------------------------------------------------------------------
// Demo dataset: 1 user, 1 storefront, 2 suppliers, 6 orders in varied states.
// ---------------------------------------------------------------------------

const userId = id();
const storefrontId = id();
const supplierAcmeId = id();
const supplierGlobexId = id();

// --- phase 2 ids ---
const ebayStorefrontId = id();
const amazonStorefrontId = id();
const supplierAmazonBusinessId = id();
const supplierAliExpressId = id();
const supplierCjId = id();
const supplierManualAmazonRetailId = id();

const users: Row[] = [
  {
    id: userId,
    clerk_user_id: 'dev-user',
    email: 'demo@fulfillment-tracker.dev',
    created_at: ts(0),
    gmail_refresh_token_ref: 'env:GMAIL_OAUTH_REFRESH_TOKEN',
    gmail_access_token_ref: 'env:GMAIL_OAUTH_ACCESS_TOKEN',
    gmail_token_expires_at: ts(60),
    gmail_last_polled_at: ts(-5),
  },
];

const storefronts: Row[] = [
  {
    id: storefrontId,
    user_id: userId,
    platform: 'shopify',
    shop_domain: 'demo-store.myshopify.com',
    access_token_ref: 'env:SHOPIFY_ACCESS_TOKEN',
    webhook_secret_ref: 'env:SHOPIFY_WEBHOOK_SECRET',
    created_at: ts(0),
    marketplace_id: null,
    oauth_refresh_token_ref: null,
    oauth_access_token_ref: null,
    oauth_expires_at: null,
    last_polled_at: null,
    non_api_mode: 0,
  },
  {
    id: ebayStorefrontId,
    user_id: userId,
    platform: 'ebay',
    shop_domain: 'demo-ebay-store',
    access_token_ref: 'env:EBAY_ACCESS_TOKEN',
    webhook_secret_ref: 'env:EBAY_WEBHOOK_SECRET',
    created_at: ts(0),
    marketplace_id: 'EBAY_US',
    oauth_refresh_token_ref: 'env:EBAY_OAUTH_REFRESH_TOKEN',
    oauth_access_token_ref: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    oauth_expires_at: ts(120),
    last_polled_at: ts(-15),
    // Demonstrates the Chrome Extension / non-API fallback path (spec 5a):
    // pushTracking bypasses eBay's API entirely for this storefront.
    non_api_mode: 1,
  },
  {
    id: amazonStorefrontId,
    user_id: userId,
    platform: 'amazon',
    shop_domain: 'demo-amazon-store',
    access_token_ref: 'env:AMAZON_ACCESS_TOKEN',
    webhook_secret_ref: 'env:AMAZON_WEBHOOK_SECRET',
    created_at: ts(0),
    marketplace_id: 'ATVPDKIKX0DER',
    oauth_refresh_token_ref: 'env:AMAZON_OAUTH_REFRESH_TOKEN',
    oauth_access_token_ref: 'env:AMAZON_OAUTH_ACCESS_TOKEN',
    oauth_expires_at: ts(90),
    last_polled_at: ts(-30),
    non_api_mode: 0,
  },
];

const suppliers: Row[] = [
  {
    id: supplierAcmeId,
    user_id: userId,
    name: 'Acme Supply Co',
    api_base_url: 'https://api.acmesupply.example.com',
    api_key_ref: 'env:SUPPLIER_API_KEY',
    email_sender_pattern: '@acmesupply.example.com',
    parser_id: 'acme-supply-v1',
    active: 1,
    created_at: ts(0),
    kind: 'api',
    provider: 'generic_rest',
    on_time_rate: 0.97,
    avg_ship_days: 2.1,
    stock_confidence: 0.95,
    priority: 10,
  },
  {
    id: supplierGlobexId,
    user_id: userId,
    name: 'Globex Goods',
    api_base_url: 'https://api.globexgoods.example.com',
    api_key_ref: 'env:SUPPLIER_API_KEY',
    email_sender_pattern: '@shipping.globexgoods.example.com',
    parser_id: 'globex-goods-v1',
    active: 1,
    created_at: ts(0),
    kind: 'api',
    provider: 'generic_rest',
    on_time_rate: 0.91,
    avg_ship_days: 3.4,
    stock_confidence: 0.88,
    priority: 5,
  },
  // --- phase 2 suppliers ---
  {
    id: supplierAmazonBusinessId,
    user_id: userId,
    name: 'Amazon Business',
    api_base_url: 'https://sellingpartnerapi-na.amazon.com',
    api_key_ref: 'env:AMAZON_BUSINESS_API_KEY',
    email_sender_pattern: '@amazon.com',
    parser_id: 'amazon-business-v1',
    active: 1,
    created_at: ts(0),
    kind: 'api',
    provider: 'amazon_business',
    on_time_rate: 0.98,
    avg_ship_days: 1.8,
    stock_confidence: 0.97,
    priority: 20,
  },
  {
    id: supplierAliExpressId,
    user_id: userId,
    name: 'AliExpress Open Platform',
    api_base_url: 'https://api.aliexpress.com',
    api_key_ref: 'env:ALIEXPRESS_API_KEY',
    email_sender_pattern: '@aliexpress.com',
    parser_id: 'aliexpress-v1',
    active: 1,
    created_at: ts(0),
    kind: 'api',
    provider: 'aliexpress',
    on_time_rate: 0.82,
    avg_ship_days: 12.5,
    stock_confidence: 0.7,
    priority: 3,
  },
  {
    id: supplierCjId,
    user_id: userId,
    name: 'CJ Dropshipping',
    api_base_url: 'https://developers.cjdropshipping.com',
    api_key_ref: 'env:CJ_API_KEY',
    email_sender_pattern: '@cjdropshipping.com',
    parser_id: 'cj-dropshipping-v1',
    active: 1,
    created_at: ts(0),
    kind: 'api',
    provider: 'cj',
    on_time_rate: 0.89,
    avg_ship_days: 7.2,
    stock_confidence: 0.8,
    priority: 8,
  },
  {
    id: supplierManualAmazonRetailId,
    user_id: userId,
    name: 'Amazon Retail (Manual)',
    api_base_url: 'https://www.amazon.com',
    api_key_ref: 'PLACEHOLDER__NO_API_KEY_MANUAL_SUPPLIER',
    email_sender_pattern: '@amazon.com',
    parser_id: 'amazon-retail-manual-v1',
    active: 1,
    created_at: ts(0),
    kind: 'manual',
    provider: 'amazon_retail',
    on_time_rate: 0.93,
    avg_ship_days: 2.5,
    stock_confidence: 0.6,
    priority: 1,
  },
];

const settings: Row[] = [
  {
    user_id: userId,
    min_margin_cents: 200,
    margin_mode: 'absolute',
    min_margin_percent: 10,
    auto_fulfill: 1,
  },
];

const webhookEvents: Row[] = [];
const orders: Row[] = [];
const orderLineItems: Row[] = [];
const fulfillments: Row[] = [];
const fulfillmentLineItems: Row[] = [];
const disputes: Row[] = [];
// --- phase 2 rows ---
const listings: Row[] = [];
const supplierOffers: Row[] = [];
const manualTasks: Row[] = [];
const trackingEvents: Row[] = [];
const messageTemplates: Row[] = [];
const messages: Row[] = [];

function shopifyWebhookEvent(n: number, orderNumber: string, minutesAgo: number): string {
  const weId = id();
  webhookEvents.push({
    id: weId,
    source: 'shopify',
    dedup_key: `wh-shopify-${n}`,
    raw_body: JSON.stringify({ id: 5000000000 + n, name: orderNumber }),
    headers_json: JSON.stringify({ 'x-shopify-webhook-id': `wh-shopify-${n}` }),
    processed: 1,
    error: null,
    received_at: ts(minutesAgo),
  });
  return weId;
}

// --- Order 1: fully shipped, single line item, UPS tracking, pushed to Shopify ---
{
  const orderId = id();
  const weId = shopifyWebhookEvent(1, '#1001', -600);
  orders.push({
    id: orderId,
    storefront_id: storefrontId,
    external_order_id: 'gid://shopify/Order/5000000001',
    external_order_number: '#1001',
    status: 'shipped',
    currency: 'USD',
    subtotal_cents: 8900,
    shipping_cents: 599,
    margin_cents: 2101,
    raw_payload_id: weId,
    created_at: ts(-600),
    updated_at: ts(-540),
  });
  const li1 = id();
  orderLineItems.push({
    id: li1,
    order_id: orderId,
    external_line_item_id: 'gid://shopify/LineItem/1',
    fulfillment_order_line_item_id: 'gid://shopify/FulfillmentOrderLineItem/1',
    sku: 'WIDGET-RED-L',
    title: 'Widget - Red / Large',
    quantity: 2,
    quantity_fulfilled: 2,
    unit_price_cents: 4450,
  });
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierAcmeId,
    cost_cents: 5200,
    tracking_number: '1Z999AA10123456780',
    carrier_declared: 'UPS',
    carrier_detected: 'UPS',
    carrier_final: 'UPS',
    tracking_status: 'in_transit',
    pushed_to_storefront: 1,
    source: 'regex',
    created_at: ts(-580),
    updated_at: ts(-540),
  });
  fulfillmentLineItems.push({ id: id(), fulfillment_id: fId, order_line_item_id: li1, quantity: 2 });
}

// --- Order 2: delivered ---
{
  const orderId = id();
  const weId = shopifyWebhookEvent(2, '#1002', -1440);
  orders.push({
    id: orderId,
    storefront_id: storefrontId,
    external_order_id: 'gid://shopify/Order/5000000002',
    external_order_number: '#1002',
    status: 'delivered',
    currency: 'USD',
    subtotal_cents: 12000,
    shipping_cents: 0,
    margin_cents: 4300,
    raw_payload_id: weId,
    created_at: ts(-1440),
    updated_at: ts(-100),
  });
  const li1 = id();
  orderLineItems.push({
    id: li1,
    order_id: orderId,
    external_line_item_id: 'gid://shopify/LineItem/2',
    fulfillment_order_line_item_id: 'gid://shopify/FulfillmentOrderLineItem/2',
    sku: 'GADGET-BLUE-M',
    title: 'Gadget - Blue / Medium',
    quantity: 1,
    quantity_fulfilled: 1,
    unit_price_cents: 12000,
  });
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierGlobexId,
    cost_cents: 7700,
    tracking_number: '70123456789012345674',
    carrier_declared: 'USPS',
    carrier_detected: 'USPS',
    carrier_final: 'USPS',
    tracking_status: 'delivered',
    pushed_to_storefront: 1,
    source: 'regex',
    created_at: ts(-1400),
    updated_at: ts(-100),
  });
  fulfillmentLineItems.push({ id: id(), fulfillment_id: fId, order_line_item_id: li1, quantity: 1 });
}

// --- Order 3: partially shipped, 2 line items, one fulfilled, one still pending ---
{
  const orderId = id();
  const weId = shopifyWebhookEvent(3, '#1003', -300);
  orders.push({
    id: orderId,
    storefront_id: storefrontId,
    external_order_id: 'gid://shopify/Order/5000000003',
    external_order_number: '#1003',
    status: 'partially_shipped',
    currency: 'USD',
    subtotal_cents: 15600,
    shipping_cents: 800,
    margin_cents: 3900,
    raw_payload_id: weId,
    created_at: ts(-300),
    updated_at: ts(-250),
  });
  const li1 = id();
  const li2 = id();
  orderLineItems.push(
    {
      id: li1,
      order_id: orderId,
      external_line_item_id: 'gid://shopify/LineItem/3',
      fulfillment_order_line_item_id: 'gid://shopify/FulfillmentOrderLineItem/3',
      sku: 'WIDGET-RED-L',
      title: 'Widget - Red / Large',
      quantity: 1,
      quantity_fulfilled: 1,
      unit_price_cents: 4450,
    },
    {
      id: li2,
      order_id: orderId,
      external_line_item_id: 'gid://shopify/LineItem/4',
      fulfillment_order_line_item_id: 'gid://shopify/FulfillmentOrderLineItem/4',
      sku: 'GIZMO-GREEN-S',
      title: 'Gizmo - Green / Small',
      quantity: 2,
      quantity_fulfilled: 0,
      unit_price_cents: 5575,
    },
  );
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierAcmeId,
    cost_cents: 3100,
    tracking_number: '1Z1A2B3C4D5E6F7G82',
    carrier_declared: 'UPS',
    carrier_detected: 'UPS',
    carrier_final: 'UPS',
    tracking_status: 'in_transit',
    pushed_to_storefront: 1,
    source: 'regex',
    created_at: ts(-280),
    updated_at: ts(-250),
  });
  fulfillmentLineItems.push({ id: id(), fulfillment_id: fId, order_line_item_id: li1, quantity: 1 });
}

// --- Order 4: fulfilling, supplier order placed, no tracking yet ---
{
  const orderId = id();
  const weId = shopifyWebhookEvent(4, '#1004', -60);
  orders.push({
    id: orderId,
    storefront_id: storefrontId,
    external_order_id: 'gid://shopify/Order/5000000004',
    external_order_number: '#1004',
    status: 'fulfilling',
    currency: 'USD',
    subtotal_cents: 6700,
    shipping_cents: 500,
    margin_cents: 2100,
    raw_payload_id: weId,
    created_at: ts(-60),
    updated_at: ts(-30),
  });
  const li1 = id();
  orderLineItems.push({
    id: li1,
    order_id: orderId,
    external_line_item_id: 'gid://shopify/LineItem/5',
    fulfillment_order_line_item_id: 'gid://shopify/FulfillmentOrderLineItem/5',
    sku: 'GADGET-BLUE-M',
    title: 'Gadget - Blue / Medium',
    quantity: 1,
    quantity_fulfilled: 0,
    unit_price_cents: 6700,
  });
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierGlobexId,
    cost_cents: 4100,
    tracking_number: null,
    carrier_declared: null,
    carrier_detected: null,
    carrier_final: null,
    tracking_status: 'pending',
    pushed_to_storefront: 0,
    source: 'supplier_api',
    created_at: ts(-30),
    updated_at: ts(-30),
  });
}

// --- Order 5: exception, ambiguous carrier needs review, open dispute ---
{
  const orderId = id();
  const weId = shopifyWebhookEvent(5, '#1005', -2880);
  orders.push({
    id: orderId,
    storefront_id: storefrontId,
    external_order_id: 'gid://shopify/Order/5000000005',
    external_order_number: '#1005',
    status: 'exception',
    currency: 'USD',
    subtotal_cents: 9900,
    shipping_cents: 650,
    margin_cents: 3050,
    raw_payload_id: weId,
    created_at: ts(-2880),
    updated_at: ts(-1500),
  });
  const li1 = id();
  orderLineItems.push({
    id: li1,
    order_id: orderId,
    external_line_item_id: 'gid://shopify/LineItem/6',
    fulfillment_order_line_item_id: 'gid://shopify/FulfillmentOrderLineItem/6',
    sku: 'GIZMO-GREEN-S',
    title: 'Gizmo - Green / Small',
    quantity: 1,
    quantity_fulfilled: 0,
    unit_price_cents: 9900,
  });
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierGlobexId,
    cost_cents: 6200,
    tracking_number: '9200111899223197428499',
    carrier_declared: null,
    carrier_detected: 'USPS',
    carrier_final: null,
    tracking_status: 'needs_review',
    pushed_to_storefront: 0,
    source: 'gemini',
    created_at: ts(-1600),
    updated_at: ts(-1500),
  });
  disputes.push({
    id: id(),
    fulfillment_id: fId,
    reason: 'No tracking status update from carrier for 7 days after label creation.',
    draft_subject: 'Tracking inquiry for shipment 9200111899223197428499',
    draft_body:
      'Hello,\n\nWe have not received a scan update for shipment 9200111899223197428499 since it was ' +
      'created 7 days ago. Could you confirm the current status or issue a replacement/refund if the ' +
      'package is lost?\n\nThank you,\nFulfillment Tracker',
    status: 'draft',
    created_at: ts(-1500),
    updated_at: ts(-1500),
  });
}

// --- Order 6: rejected, margin below threshold, never fulfilled ---
{
  const orderId = id();
  const weId = shopifyWebhookEvent(6, '#1006', -120);
  orders.push({
    id: orderId,
    storefront_id: storefrontId,
    external_order_id: 'gid://shopify/Order/5000000006',
    external_order_number: '#1006',
    status: 'rejected',
    currency: 'USD',
    subtotal_cents: 3200,
    shipping_cents: 400,
    margin_cents: -150,
    raw_payload_id: weId,
    created_at: ts(-120),
    updated_at: ts(-115),
  });
  orderLineItems.push({
    id: id(),
    order_id: orderId,
    external_line_item_id: 'gid://shopify/LineItem/7',
    fulfillment_order_line_item_id: null,
    sku: 'WIDGET-RED-L',
    title: 'Widget - Red / Large',
    quantity: 1,
    quantity_fulfilled: 0,
    unit_price_cents: 3200,
  });
}

// --- Order 7: eBay order, Amazon Logistics (TBA) tracking, proxied to a
// marketplace-compliant BCE number before being pushed to eBay (spec 7). ---
{
  const orderId = id();
  orders.push({
    id: orderId,
    storefront_id: ebayStorefrontId,
    external_order_id: 'ebay-16-11635-28233',
    external_order_number: '16-11635-28233',
    status: 'shipped',
    currency: 'USD',
    subtotal_cents: 5999,
    shipping_cents: 0,
    margin_cents: 2799,
    raw_payload_id: null, // eBay orders are polled (listNewOrders), not webhook-pushed
    created_at: ts(-900),
    updated_at: ts(-820),
  });
  const li1 = id();
  orderLineItems.push({
    id: li1,
    order_id: orderId,
    external_line_item_id: 'ebay-li-16-11635-28233-1',
    fulfillment_order_line_item_id: null,
    sku: 'WIDGET-RED-L',
    title: 'Widget - Red / Large (eBay)',
    quantity: 1,
    quantity_fulfilled: 1,
    unit_price_cents: 5999,
  });
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierAmazonBusinessId,
    cost_cents: 3200,
    tracking_number: 'TBA123456789012',
    carrier_declared: 'AMZL',
    carrier_detected: 'AMZL',
    carrier_final: 'AMZL',
    tracking_status: 'in_transit',
    pushed_to_storefront: 1,
    source: 'supplier_api',
    created_at: ts(-880),
    updated_at: ts(-820),
  });
  fulfillmentLineItems.push({ id: id(), fulfillment_id: fId, order_line_item_id: li1, quantity: 1 });
  trackingEvents.push({
    id: id(),
    fulfillment_id: fId,
    original_tracking: 'TBA123456789012',
    proxy_tracking: 'BCE7F3A9D2E1',
    proxy_carrier: 'bluecare_express',
    status: 'in_transit',
    raw_status: 'In Transit',
    created_at: ts(-820),
  });
  messages.push({
    id: id(),
    order_id: orderId,
    trigger: 'shipped',
    template_id: null,
    body: 'Good news — your order is on the way! Tracking: BCE7F3A9D2E1 (Bluecare Express).',
    status: 'sent',
    sent_at: ts(-819),
    created_at: ts(-820),
  });
}

// --- Order 8: eBay order sourced to a MANUAL supplier (Amazon Retail) —
// sitting in the Buy Queue awaiting a human + the Chrome extension (spec 6d). ---
{
  const orderId = id();
  orders.push({
    id: orderId,
    storefront_id: ebayStorefrontId,
    external_order_id: 'ebay-19-04471-90215',
    external_order_number: '19-04471-90215',
    status: 'fulfilling',
    currency: 'USD',
    subtotal_cents: 4250,
    shipping_cents: 0,
    margin_cents: 1400,
    raw_payload_id: null,
    created_at: ts(-45),
    updated_at: ts(-40),
  });
  const li1 = id();
  orderLineItems.push({
    id: li1,
    order_id: orderId,
    external_line_item_id: 'ebay-li-19-04471-90215-1',
    fulfillment_order_line_item_id: null,
    sku: 'GIZMO-GREEN-S',
    title: 'Gizmo - Green / Small',
    quantity: 1,
    quantity_fulfilled: 0,
    unit_price_cents: 4250,
  });
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierManualAmazonRetailId,
    cost_cents: null,
    tracking_number: null,
    carrier_declared: null,
    carrier_detected: null,
    carrier_final: null,
    tracking_status: 'pending',
    pushed_to_storefront: 0,
    source: 'manual',
    created_at: ts(-40),
    updated_at: ts(-40),
  });
  manualTasks.push({
    id: id(),
    order_id: orderId,
    supplier_id: supplierManualAmazonRetailId,
    state: 'pending',
    payload_json: JSON.stringify({
      sku: 'GIZMO-GREEN-S',
      quantity: 1,
      maxCostCents: 3500,
      shipTo: {
        name: 'Jordan Buyer',
        address1: '742 Evergreen Terrace',
        city: 'Springfield',
        state: 'IL',
        zip: '62704',
        country: 'US',
      },
    }),
    created_at: ts(-40),
    updated_at: ts(-40),
  });
}

// --- Order 9: eBay order fulfilled via CJ Dropshipping, plain USPS tracking —
// NOT Amazon Logistics, so it is pushed straight through with no proxy step. ---
{
  const orderId = id();
  orders.push({
    id: orderId,
    storefront_id: ebayStorefrontId,
    external_order_id: 'ebay-11-88203-44120',
    external_order_number: '11-88203-44120',
    status: 'delivered',
    currency: 'USD',
    subtotal_cents: 3499,
    shipping_cents: 0,
    margin_cents: 1050,
    raw_payload_id: null,
    created_at: ts(-4320),
    updated_at: ts(-2000),
  });
  const li1 = id();
  orderLineItems.push({
    id: li1,
    order_id: orderId,
    external_line_item_id: 'ebay-li-11-88203-44120-1',
    fulfillment_order_line_item_id: null,
    sku: 'GADGET-BLUE-M',
    title: 'Gadget - Blue / Medium',
    quantity: 1,
    quantity_fulfilled: 1,
    unit_price_cents: 3499,
  });
  const fId = id();
  fulfillments.push({
    id: fId,
    order_id: orderId,
    supplier_id: supplierCjId,
    cost_cents: 2000,
    tracking_number: '70123456789012345674',
    carrier_declared: 'USPS',
    carrier_detected: 'USPS',
    carrier_final: 'USPS',
    tracking_status: 'delivered',
    pushed_to_storefront: 1,
    source: 'supplier_api',
    created_at: ts(-4200),
    updated_at: ts(-2000),
  });
  fulfillmentLineItems.push({ id: id(), fulfillment_id: fId, order_line_item_id: li1, quantity: 1 });
  trackingEvents.push(
    {
      id: id(),
      fulfillment_id: fId,
      original_tracking: '70123456789012345674',
      proxy_tracking: null,
      proxy_carrier: null,
      status: 'in_transit',
      raw_status: 'InTransit',
      created_at: ts(-3000),
    },
    {
      id: id(),
      fulfillment_id: fId,
      original_tracking: '70123456789012345674',
      proxy_tracking: null,
      proxy_carrier: null,
      status: 'delivered',
      raw_status: 'Delivered',
      created_at: ts(-2000),
    },
  );
  messages.push(
    {
      id: id(),
      order_id: orderId,
      trigger: 'delivered',
      template_id: null,
      body: 'Your order has been delivered. We hope you love it!',
      status: 'sent',
      sent_at: ts(-1999),
      created_at: ts(-2000),
    },
    {
      id: id(),
      order_id: orderId,
      trigger: 'feedback_reminder',
      template_id: null,
      body: "If you have a moment, we'd really appreciate your feedback on your recent purchase.",
      status: 'pending',
      sent_at: null,
      created_at: ts(-1900),
    },
  );
}

// --- Catalog: listings + scored supplier offers (spec 3 "Catalog Ops") ---
{
  const listingMatchedId = id();
  listings.push(
    {
      id: listingMatchedId,
      storefront_id: ebayStorefrontId,
      external_listing_id: 'ebay-listing-widget-red-l',
      sku: 'WIDGET-RED-L',
      title: 'Widget - Red / Large',
      price_cents: 5999,
      quantity_available: 42,
      supplier_id: supplierAmazonBusinessId,
      supplier_product_id: 'B0EXAMPLE001',
      match_confidence: 1.0,
      match_source: 'exact_sku',
      auto_reprice: 1,
      auto_pause: 1,
      status: 'active',
      created_at: ts(-2000),
      updated_at: ts(-30),
    },
    {
      id: id(),
      storefront_id: amazonStorefrontId,
      external_listing_id: 'amz-listing-gadget-blue-m',
      sku: 'GADGET-BLUE-M',
      title: 'Gadget Blue Medium Size — Fast Shipping',
      price_cents: 8999,
      quantity_available: 0,
      supplier_id: supplierAliExpressId,
      supplier_product_id: 'AE10000123',
      match_confidence: 0.93,
      match_source: 'fuzzy_title',
      auto_reprice: 1,
      auto_pause: 1,
      status: 'paused_out_of_stock',
      created_at: ts(-2000),
      updated_at: ts(-60),
    },
    {
      id: id(),
      storefront_id: ebayStorefrontId,
      external_listing_id: 'ebay-listing-gizmo-green-s',
      sku: 'GIZMO-GREEN-S',
      title: 'Gizmo (Green, Small) - Fast Ship',
      price_cents: 7499,
      quantity_available: 15,
      supplier_id: null,
      supplier_product_id: null,
      match_confidence: null,
      match_source: null,
      auto_reprice: 0,
      auto_pause: 1,
      status: 'active',
      created_at: ts(-2000),
      updated_at: ts(-2000),
    },
  );
  supplierOffers.push(
    {
      id: id(),
      listing_id: listingMatchedId,
      supplier_id: supplierAmazonBusinessId,
      supplier_product_id: 'B0EXAMPLE001',
      cost_cents: 3200,
      shipping_cents: 0,
      in_stock: 1,
      ship_days: 1.5,
      score: 0.94,
      checked_at: ts(-30),
    },
    {
      id: id(),
      listing_id: listingMatchedId,
      supplier_id: supplierAcmeId,
      supplier_product_id: 'ACME-WIDGET-RED-L',
      cost_cents: 3400,
      shipping_cents: 350,
      in_stock: 1,
      ship_days: 2.5,
      score: 0.81,
      checked_at: ts(-30),
    },
  );
}

// --- Standard buyer-message templates (spec "Buyer Engagement") ---
messageTemplates.push(
  {
    id: id(),
    user_id: userId,
    trigger: 'sold',
    body_template: "Thanks for your order! We're getting {{sku}} ready to ship.",
    active: 1,
    created_at: ts(0),
  },
  {
    id: id(),
    user_id: userId,
    trigger: 'shipped',
    body_template: 'Good news — your order is on the way! Tracking: {{trackingNumber}} ({{carrier}}).',
    active: 1,
    created_at: ts(0),
  },
  {
    id: id(),
    user_id: userId,
    trigger: 'delivered',
    body_template: 'Your order has been delivered. We hope you love it!',
    active: 1,
    created_at: ts(0),
  },
  {
    id: id(),
    user_id: userId,
    trigger: 'feedback_reminder',
    body_template: "If you have a moment, we'd really appreciate your feedback on your recent purchase.",
    active: 1,
    created_at: ts(0),
  },
);

// A malformed/unmatched supplier email — surfaces in the "Needs review" list.
webhookEvents.push({
  id: id(),
  source: 'email',
  dedup_key: '<msg-malformed-0007@mail.unknown-supplier.example.com>',
  raw_body: 'From: noreply@unknown-supplier.example.com\nSubject: Re: your package\n\nThanks for your order!',
  headers_json: JSON.stringify({ from: 'noreply@unknown-supplier.example.com' }),
  processed: 1,
  error: 'No supplier matched sender address; Gemini fallback confidence 0.31 (< 0.8 threshold)',
  received_at: ts(-200),
});

const sql = [
  'PRAGMA foreign_keys = ON;',
  'BEGIN TRANSACTION;',
  insert('users', users),
  insert('storefronts', storefronts),
  insert('suppliers', suppliers),
  insert('settings', settings),
  insert('webhook_events', webhookEvents),
  insert('orders', orders),
  insert('order_line_items', orderLineItems),
  insert('fulfillments', fulfillments),
  insert('fulfillment_line_items', fulfillmentLineItems),
  insert('disputes', disputes),
  insert('listings', listings),
  insert('supplier_offers', supplierOffers),
  insert('manual_tasks', manualTasks),
  insert('tracking_events', trackingEvents),
  insert('message_templates', messageTemplates),
  insert('messages', messages),
  'COMMIT;',
]
  .filter(Boolean)
  .join('\n\n');

const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed.sql');
writeFileSync(outPath, sql + '\n');
console.log(`Wrote ${outPath}`);
