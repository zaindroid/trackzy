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
    platform: text('platform', { enum: ['shopify', 'ebay', 'amazon'] }).notNull(),
    shopDomain: text('shop_domain').notNull().unique(),
    accessTokenRef: text('access_token_ref').notNull(),
    webhookSecretRef: text('webhook_secret_ref').notNull(),
    createdAt: integer('created_at').notNull(),
    // --- phase 2: marketplace (eBay/Amazon) additions ---
    // Shopify keeps using accessTokenRef/webhookSecretRef above (static token +
    // HMAC secret); marketplaces use OAuth2 user tokens instead, hence the
    // separate ref/expiry columns rather than reusing accessTokenRef.
    marketplaceId: text('marketplace_id'),
    oauthRefreshTokenRef: text('oauth_refresh_token_ref'),
    oauthAccessTokenRef: text('oauth_access_token_ref'),
    oauthExpiresAt: integer('oauth_expires_at'),
    lastPolledAt: integer('last_polled_at'),
    nonApiMode: integer('non_api_mode').notNull().default(0),
  },
  (t) => ({
    platformCheck: check('storefronts_platform_check', sql`${t.platform} in ('shopify', 'ebay', 'amazon')`),
  }),
);

export const suppliers = sqliteTable(
  'suppliers',
  {
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
    // --- phase 2: multi-supplier additions ---
    // 'api' suppliers are ordered through SupplierClient.createOrder(); 'manual'
    // suppliers (Amazon Retail, Temu, Walmart) instead create a manual_tasks row
    // for the Buy Queue / Chrome extension flow (see manualTasks below).
    kind: text('kind', { enum: ['api', 'manual'] })
      .notNull()
      .default('api'),
    provider: text('provider', {
      enum: ['amazon_business', 'amazon_retail', 'aliexpress', 'cj', 'generic_rest', 'manual'],
    })
      .notNull()
      .default('generic_rest'),
    onTimeRate: real('on_time_rate').notNull().default(1.0),
    avgShipDays: real('avg_ship_days'),
    stockConfidence: real('stock_confidence'),
    priority: integer('priority').notNull().default(0),
  },
  (t) => ({
    kindCheck: check('suppliers_kind_check', sql`${t.kind} in ('api', 'manual')`),
    providerCheck: check(
      'suppliers_provider_check',
      sql`${t.provider} in ('amazon_business', 'amazon_retail', 'aliexpress', 'cj', 'generic_rest', 'manual')`,
    ),
  }),
);

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

// --- phase 2: catalog ops (listings, supplier offers) ---

export const listings = sqliteTable(
  'listings',
  {
    id: text('id').primaryKey(),
    storefrontId: text('storefront_id')
      .notNull()
      .references(() => storefronts.id),
    externalListingId: text('external_listing_id').notNull(),
    sku: text('sku').notNull(),
    title: text('title').notNull(),
    priceCents: integer('price_cents').notNull(),
    quantityAvailable: integer('quantity_available').notNull(),
    supplierId: text('supplier_id').references(() => suppliers.id),
    supplierProductId: text('supplier_product_id'),
    matchConfidence: real('match_confidence'),
    matchSource: text('match_source', {
      enum: ['exact_sku', 'fuzzy_title', 'embedding', 'llm', 'manual'],
    }),
    autoReprice: integer('auto_reprice').notNull().default(1),
    autoPause: integer('auto_pause').notNull().default(1),
    status: text('status', {
      enum: ['active', 'paused_out_of_stock', 'paused_margin', 'paused_manual'],
    })
      .notNull()
      .default('active'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    storefrontExternalListingUnique: uniqueIndex('listings_storefront_id_external_listing_id_unique').on(
      t.storefrontId,
      t.externalListingId,
    ),
    matchSourceCheck: check(
      'listings_match_source_check',
      sql`${t.matchSource} in ('exact_sku', 'fuzzy_title', 'embedding', 'llm', 'manual')`,
    ),
    statusCheck: check(
      'listings_status_check',
      sql`${t.status} in ('active', 'paused_out_of_stock', 'paused_margin', 'paused_manual')`,
    ),
  }),
);

export const supplierOffers = sqliteTable('supplier_offers', {
  id: text('id').primaryKey(),
  listingId: text('listing_id')
    .notNull()
    .references(() => listings.id),
  supplierId: text('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  supplierProductId: text('supplier_product_id').notNull(),
  costCents: integer('cost_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull().default(0),
  inStock: integer('in_stock').notNull().default(1),
  shipDays: real('ship_days'),
  score: real('score'),
  checkedAt: integer('checked_at').notNull(),
});

// --- phase 2: MANUAL supplier / Buy Queue / Chrome extension flow ---

export const manualTasks = sqliteTable(
  'manual_tasks',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    state: text('state', { enum: ['pending', 'claimed', 'ordered', 'abandoned'] })
      .notNull()
      .default('pending'),
    payloadJson: text('payload_json').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    stateCheck: check('manual_tasks_state_check', sql`${t.state} in ('pending', 'claimed', 'ordered', 'abandoned')`),
  }),
);

// --- phase 2: tracking conversion (Bluecare Express / Aquiline proxy) + event log ---

export const trackingEvents = sqliteTable(
  'tracking_events',
  {
    id: text('id').primaryKey(),
    fulfillmentId: text('fulfillment_id')
      .notNull()
      .references(() => fulfillments.id),
    originalTracking: text('original_tracking'),
    proxyTracking: text('proxy_tracking'),
    proxyCarrier: text('proxy_carrier'),
    status: text('status', {
      enum: ['pending', 'in_transit', 'delivered', 'exception', 'needs_review'],
    }).notNull(),
    rawStatus: text('raw_status'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    statusCheck: check(
      'tracking_events_status_check',
      sql`${t.status} in ('pending', 'in_transit', 'delivered', 'exception', 'needs_review')`,
    ),
  }),
);

// --- phase 2: buyer messaging ---

export const messageTemplates = sqliteTable(
  'message_templates',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    trigger: text('trigger', {
      enum: ['sold', 'shipped', 'delivered', 'stalled', 'feedback_reminder'],
    }).notNull(),
    bodyTemplate: text('body_template').notNull(),
    active: integer('active').notNull().default(1),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    triggerCheck: check(
      'message_templates_trigger_check',
      sql`${t.trigger} in ('sold', 'shipped', 'delivered', 'stalled', 'feedback_reminder')`,
    ),
  }),
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    trigger: text('trigger', {
      enum: ['sold', 'shipped', 'delivered', 'stalled', 'feedback_reminder'],
    }).notNull(),
    templateId: text('template_id').references(() => messageTemplates.id),
    body: text('body').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'skipped'] })
      .notNull()
      .default('pending'),
    sentAt: integer('sent_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    triggerCheck: check(
      'messages_trigger_check',
      sql`${t.trigger} in ('sold', 'shipped', 'delivered', 'stalled', 'feedback_reminder')`,
    ),
    statusCheck: check('messages_status_check', sql`${t.status} in ('pending', 'sent', 'failed', 'skipped')`),
  }),
);

export const usersRelations = relations(users, ({ many, one }) => ({
  storefronts: many(storefronts),
  suppliers: many(suppliers),
  settings: one(settings, { fields: [users.id], references: [settings.userId] }),
  messageTemplates: many(messageTemplates),
}));

export const storefrontsRelations = relations(storefronts, ({ one, many }) => ({
  user: one(users, { fields: [storefronts.userId], references: [users.id] }),
  orders: many(orders),
  listings: many(listings),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  storefront: one(storefronts, { fields: [orders.storefrontId], references: [storefronts.id] }),
  lineItems: many(orderLineItems),
  fulfillments: many(fulfillments),
  manualTasks: many(manualTasks),
  messages: many(messages),
}));

export const orderLineItemsRelations = relations(orderLineItems, ({ one }) => ({
  order: one(orders, { fields: [orderLineItems.orderId], references: [orders.id] }),
}));

export const fulfillmentsRelations = relations(fulfillments, ({ one, many }) => ({
  order: one(orders, { fields: [fulfillments.orderId], references: [orders.id] }),
  supplier: one(suppliers, { fields: [fulfillments.supplierId], references: [suppliers.id] }),
  lineItems: many(fulfillmentLineItems),
  disputes: many(disputes),
  trackingEvents: many(trackingEvents),
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
  listings: many(listings),
  supplierOffers: many(supplierOffers),
  manualTasks: many(manualTasks),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  storefront: one(storefronts, { fields: [listings.storefrontId], references: [storefronts.id] }),
  supplier: one(suppliers, { fields: [listings.supplierId], references: [suppliers.id] }),
  offers: many(supplierOffers),
}));

export const supplierOffersRelations = relations(supplierOffers, ({ one }) => ({
  listing: one(listings, { fields: [supplierOffers.listingId], references: [listings.id] }),
  supplier: one(suppliers, { fields: [supplierOffers.supplierId], references: [suppliers.id] }),
}));

export const manualTasksRelations = relations(manualTasks, ({ one }) => ({
  order: one(orders, { fields: [manualTasks.orderId], references: [orders.id] }),
  supplier: one(suppliers, { fields: [manualTasks.supplierId], references: [suppliers.id] }),
}));

export const trackingEventsRelations = relations(trackingEvents, ({ one }) => ({
  fulfillment: one(fulfillments, { fields: [trackingEvents.fulfillmentId], references: [fulfillments.id] }),
}));

export const messageTemplatesRelations = relations(messageTemplates, ({ one, many }) => ({
  user: one(users, { fields: [messageTemplates.userId], references: [users.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  order: one(orders, { fields: [messages.orderId], references: [orders.id] }),
  template: one(messageTemplates, { fields: [messages.templateId], references: [messageTemplates.id] }),
}));
