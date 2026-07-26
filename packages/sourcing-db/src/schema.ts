import { sqliteTable, text, integer, real, check } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// The sourcing portal's OWN database — fully independent of trackzy's
// packages/db (separate D1, separate deploy). Shares only the Clerk identity
// provider with trackzy (same clerkUserId across both products), which is
// what makes the post-listing handoff to trackzy land on the right user.
// See the plan / DECISIONS.md.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  email: text('email').notNull(),
  createdAt: integer('created_at').notNull(),
});

// The seller's eBay OAuth grant, used to CREATE listings via the Trading API
// (AddFixedPriceItem). A separate grant from trackzy's own eBay connection —
// same account, two independent tokens, by design. Tokens stored encrypted
// (enc:v1:... — same AES-256-GCM scheme as trackzy's credentialCrypto).
export const ebayConnections = sqliteTable('ebay_connections', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  oauthAccessTokenRef: text('oauth_access_token_ref').notNull(),
  oauthRefreshTokenRef: text('oauth_refresh_token_ref').notNull(),
  oauthExpiresAt: integer('oauth_expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Supplier the sourcing bot searches for a sourceable match + cost. v1 is
// CJ-only (reliable); the `provider` enum leaves room for AliExpress in
// phase 2 without a schema change to the enum's storage (SQLite CHECK).
export const supplierConnections = sqliteTable(
  'supplier_connections',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider', { enum: ['cj', 'aliexpress'] }).notNull(),
    apiKeyRef: text('api_key_ref').notNull(),
    apiBaseUrl: text('api_base_url').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    providerCheck: check('supplier_connections_provider_check', sql`${t.provider} in ('cj', 'aliexpress')`),
  }),
);

// Feeds the inline shipping/return details on AddFixedPriceItem (avoiding the
// eBay Business-Policies dependency) plus the margin/markup math. One row per
// user, created with sensible defaults on first visit.
export const sellerSettings = sqliteTable('seller_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  defaultShippingCostCents: integer('default_shipping_cost_cents').notNull().default(0),
  handlingTimeDays: integer('handling_time_days').notNull().default(3),
  returnPolicy: text('return_policy', { enum: ['no_returns', '30_day', '60_day'] })
    .notNull()
    .default('30_day'),
  targetMarginPercent: real('target_margin_percent').notNull().default(30),
  ebayFeePercent: real('ebay_fee_percent').notNull().default(13.25),
  // eBay requires an item location on every listing (for shipping calc /
  // buyer display). Postal code is the minimum; defaults to a placeholder the
  // user is prompted to change before their first real listing.
  itemLocationPostalCode: text('item_location_postal_code').notNull().default('10001'),
  updatedAt: integer('updated_at').notNull(),
});

// The core table — one row per researched product candidate. Populated by the
// research pipeline (status 'draft'), then either published to eBay
// (status 'listed', ebayItemId set) or dismissed by the user.
export const productCandidates = sqliteTable(
  'product_candidates',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    runId: text('run_id').references(() => researchRuns.id),
    keyword: text('keyword').notNull(),
    // Real eBay sold-data signals (via Apify).
    ebayAvgSoldPriceCents: integer('ebay_avg_sold_price_cents').notNull(),
    ebayMedianPriceCents: integer('ebay_median_price_cents').notNull(),
    ebaySoldCount: integer('ebay_sold_count').notNull(),
    // Matched supplier product (v1: CJ).
    supplierProvider: text('supplier_provider').notNull(),
    supplierProductId: text('supplier_product_id').notNull(),
    supplierCostCents: integer('supplier_cost_cents').notNull(),
    supplierProductUrl: text('supplier_product_url'),
    supplierImageUrlsJson: text('supplier_image_urls_json').notNull(),
    // Computed economics.
    marginCents: integer('margin_cents').notNull(),
    marginPercent: real('margin_percent').notNull(),
    opportunityScore: real('opportunity_score').notNull(),
    suggestedSellPriceCents: integer('suggested_sell_price_cents').notNull(),
    // AI-generated, human-editable listing content.
    generatedTitle: text('generated_title').notNull(),
    generatedDescription: text('generated_description').notNull(),
    generatedAspectsJson: text('generated_aspects_json').notNull(),
    categoryId: text('category_id'),
    // Lifecycle.
    status: text('status', { enum: ['draft', 'listed', 'dismissed'] })
      .notNull()
      .default('draft'),
    ebayItemId: text('ebay_item_id'),
    sku: text('sku'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    statusCheck: check('product_candidates_status_check', sql`${t.status} in ('draft', 'listed', 'dismissed')`),
  }),
);

// Groups one research session (a seed keyword/category the user submitted).
export const researchRuns = sqliteTable(
  'research_runs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    seed: text('seed').notNull(),
    status: text('status', { enum: ['running', 'done', 'failed'] })
      .notNull()
      .default('running'),
    error: text('error'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    statusCheck: check('research_runs_status_check', sql`${t.status} in ('running', 'done', 'failed')`),
  }),
);

export const usersRelations = relations(users, ({ one, many }) => ({
  ebayConnection: one(ebayConnections, { fields: [users.id], references: [ebayConnections.userId] }),
  supplierConnections: many(supplierConnections),
  sellerSettings: one(sellerSettings, { fields: [users.id], references: [sellerSettings.userId] }),
  candidates: many(productCandidates),
  runs: many(researchRuns),
}));

export const productCandidatesRelations = relations(productCandidates, ({ one }) => ({
  user: one(users, { fields: [productCandidates.userId], references: [users.id] }),
  run: one(researchRuns, { fields: [productCandidates.runId], references: [researchRuns.id] }),
}));

export const researchRunsRelations = relations(researchRuns, ({ one, many }) => ({
  user: one(users, { fields: [researchRuns.userId], references: [users.id] }),
  candidates: many(productCandidates),
}));
