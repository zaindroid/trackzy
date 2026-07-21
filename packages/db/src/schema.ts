import { sqliteTable, text, integer, real, uniqueIndex, index, check } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const storefronts = sqliteTable(
  'storefronts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    platform: text('platform', { enum: ['shopify'] }).notNull(),
    shopDomain: text('shop_domain').notNull().unique(),
    accessTokenRef: text('access_token_ref').notNull(),
    webhookSecretRef: text('webhook_secret_ref').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    platformCheck: check('storefronts_platform_check', sql`${t.platform} in ('shopify')`),
  }),
);

export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  apiBaseUrl: text('api_base_url').notNull(),
  apiKeyRef: text('api_key_ref').notNull(),
  emailSenderPattern: text('email_sender_pattern').notNull(),
  parserId: text('parser_id').notNull(),
  active: integer('active').notNull().default(1),
  createdAt: integer('created_at').notNull(),
});

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    source: text('source', { enum: ['shopify', '17track', 'email'] }).notNull(),
    dedupKey: text('dedup_key').notNull(),
    rawBody: text('raw_body').notNull(),
    headersJson: text('headers_json').notNull(),
    processed: integer('processed').notNull().default(0),
    error: text('error'),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => ({
    sourceDedupUnique: uniqueIndex('webhook_events_source_dedup_key_unique').on(t.source, t.dedupKey),
    sourceCheck: check('webhook_events_source_check', sql`${t.source} in ('shopify', '17track', 'email')`),
  }),
);

export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    storefrontId: text('storefront_id')
      .notNull()
      .references(() => storefronts.id),
    externalOrderId: text('external_order_id').notNull(),
    externalOrderNumber: text('external_order_number').notNull(),
    status: text('status', {
      enum: [
        'received',
        'evaluating',
        'fulfilling',
        'partially_shipped',
        'shipped',
        'delivered',
        'exception',
        'rejected',
        'cancelled',
      ],
    })
      .notNull()
      .default('received'),
    currency: text('currency').notNull(),
    subtotalCents: integer('subtotal_cents').notNull(),
    shippingCents: integer('shipping_cents').notNull(),
    marginCents: integer('margin_cents'),
    rawPayloadId: text('raw_payload_id').references(() => webhookEvents.id),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    storefrontExternalOrderUnique: uniqueIndex('orders_storefront_id_external_order_id_unique').on(
      t.storefrontId,
      t.externalOrderId,
    ),
    statusCheck: check(
      'orders_status_check',
      sql`${t.status} in ('received', 'evaluating', 'fulfilling', 'partially_shipped', 'shipped', 'delivered', 'exception', 'rejected', 'cancelled')`,
    ),
  }),
);

export const orderLineItems = sqliteTable('order_line_items', {
  id: text('id').primaryKey(),
  orderId: text('order_id')
    .notNull()
    .references(() => orders.id),
  externalLineItemId: text('external_line_item_id').notNull(),
  fulfillmentOrderLineItemId: text('fulfillment_order_line_item_id'),
  sku: text('sku').notNull(),
  title: text('title').notNull(),
  quantity: integer('quantity').notNull(),
  quantityFulfilled: integer('quantity_fulfilled').notNull().default(0),
  unitPriceCents: integer('unit_price_cents').notNull(),
});

export const fulfillments = sqliteTable(
  'fulfillments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    costCents: integer('cost_cents'),
    trackingNumber: text('tracking_number'),
    carrierDeclared: text('carrier_declared'),
    carrierDetected: text('carrier_detected'),
    carrierFinal: text('carrier_final'),
    trackingStatus: text('tracking_status').notNull().default('pending'),
    pushedToStorefront: integer('pushed_to_storefront').notNull().default(0),
    source: text('source', { enum: ['regex', 'gemini', 'manual', 'supplier_api'] }).notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    trackingNumberIdx: index('fulfillments_tracking_number_idx').on(t.trackingNumber),
    sourceCheck: check(
      'fulfillments_source_check',
      sql`${t.source} in ('regex', 'gemini', 'manual', 'supplier_api')`,
    ),
  }),
);

export const fulfillmentLineItems = sqliteTable('fulfillment_line_items', {
  id: text('id').primaryKey(),
  fulfillmentId: text('fulfillment_id')
    .notNull()
    .references(() => fulfillments.id),
  orderLineItemId: text('order_line_item_id')
    .notNull()
    .references(() => orderLineItems.id),
  quantity: integer('quantity').notNull(),
});

export const disputes = sqliteTable(
  'disputes',
  {
    id: text('id').primaryKey(),
    fulfillmentId: text('fulfillment_id')
      .notNull()
      .references(() => fulfillments.id),
    reason: text('reason').notNull(),
    draftSubject: text('draft_subject').notNull(),
    draftBody: text('draft_body').notNull(),
    status: text('status', {
      enum: ['draft', 'approved', 'sent', 'resolved', 'rejected'],
    })
      .notNull()
      .default('draft'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    statusCheck: check(
      'disputes_status_check',
      sql`${t.status} in ('draft', 'approved', 'sent', 'resolved', 'rejected')`,
    ),
  }),
);

export const settings = sqliteTable(
  'settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id),
    minMarginCents: integer('min_margin_cents').notNull().default(200),
    marginMode: text('margin_mode', { enum: ['absolute', 'percent'] })
      .notNull()
      .default('absolute'),
    minMarginPercent: real('min_margin_percent').notNull().default(10),
    autoFulfill: integer('auto_fulfill').notNull().default(1),
  },
  (t) => ({
    marginModeCheck: check('settings_margin_mode_check', sql`${t.marginMode} in ('absolute', 'percent')`),
  }),
);

export const usersRelations = relations(users, ({ many, one }) => ({
  storefronts: many(storefronts),
  suppliers: many(suppliers),
  settings: one(settings, { fields: [users.id], references: [settings.userId] }),
}));

export const storefrontsRelations = relations(storefronts, ({ one, many }) => ({
  user: one(users, { fields: [storefronts.userId], references: [users.id] }),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  storefront: one(storefronts, { fields: [orders.storefrontId], references: [storefronts.id] }),
  lineItems: many(orderLineItems),
  fulfillments: many(fulfillments),
}));

export const orderLineItemsRelations = relations(orderLineItems, ({ one }) => ({
  order: one(orders, { fields: [orderLineItems.orderId], references: [orders.id] }),
}));

export const fulfillmentsRelations = relations(fulfillments, ({ one, many }) => ({
  order: one(orders, { fields: [fulfillments.orderId], references: [orders.id] }),
  supplier: one(suppliers, { fields: [fulfillments.supplierId], references: [suppliers.id] }),
  lineItems: many(fulfillmentLineItems),
  disputes: many(disputes),
}));

export const fulfillmentLineItemsRelations = relations(fulfillmentLineItems, ({ one }) => ({
  fulfillment: one(fulfillments, {
    fields: [fulfillmentLineItems.fulfillmentId],
    references: [fulfillments.id],
  }),
  orderLineItem: one(orderLineItems, {
    fields: [fulfillmentLineItems.orderLineItemId],
    references: [orderLineItems.id],
  }),
}));

export const disputesRelations = relations(disputes, ({ one }) => ({
  fulfillment: one(fulfillments, { fields: [disputes.fulfillmentId], references: [fulfillments.id] }),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  user: one(users, { fields: [suppliers.userId], references: [users.id] }),
  fulfillments: many(fulfillments),
}));
