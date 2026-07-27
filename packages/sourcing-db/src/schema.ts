import { sqliteTable, text, integer, real, check, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
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
  // The seller's eBay identity, captured at connect. Needed to honor eBay's
  // Marketplace Account Deletion notification: when eBay tells us a member
  // closed their account, this is how we find and purge that seller's stored
  // connection (see webhooks.ebay-deletion.ts). eBay is migrating from
  // usernames to immutable user IDs (per their API-update notice), and the
  // deletion payload carries BOTH — so we store both and match on either.
  ebayUsername: text('ebay_username'),
  ebayUserId: text('ebay_user_id'),
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

// Caches the (paid) ScraperAPI eBay demand result per NORMALIZED niche keyword,
// so repeated/overlapping research runs don't re-spend credits. GLOBAL (not
// per-user) — niches recur heavily across users, so a shared cache means the
// marginal ScraperAPI cost per search trends toward zero as usage grows. Rows
// older than the pipeline's TTL are treated as misses and refreshed.
export const demandCache = sqliteTable('demand_cache', {
  normalizedKey: text('normalized_key').primaryKey(),
  dataJson: text('data_json').notNull(),
  lastChecked: integer('last_checked').notNull(),
});

// The platform's credit balance per user. `balance` is the spendable credit
// count (cached for fast reads); the source-of-truth history is credit_ledger.
// `trialGrantedAt` makes the one-time signup grant idempotent.
export const creditAccounts = sqliteTable('credit_accounts', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id),
  balance: integer('balance').notNull().default(0),
  trialGrantedAt: integer('trial_granted_at'),
  // Subscription state, driven by Lemon Squeezy webhooks. `plan` is null for
  // free users; `subscriptionStatus` mirrors LS (active/cancelled/expired/…).
  plan: text('plan'),
  subscriptionStatus: text('subscription_status'),
  subscriptionId: text('subscription_id'),
  subscriptionRenewsAt: integer('subscription_renews_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// Append-only ledger of every credit change (grant, spend, purchase, refund),
// for auditability and the dashboard's usage history. `delta` is +grant/-spend;
// `balanceAfter` snapshots the resulting balance; `reason` + `refId` explain it.
export const creditLedger = sqliteTable('credit_ledger', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  delta: integer('delta').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  reason: text('reason').notNull(),
  refId: text('ref_id'),
  createdAt: integer('created_at').notNull(),
});

// The proprietary "winners library" — a GLOBAL, accumulating store of vetted
// high-score products found across every user's research (and, later, Radar).
// Deduped per niche (normalized_key unique), keeping the best-scoring find. It's
// the compounding data moat: browsable as teasers (free), unlockable for the
// full sourcing detail + list-ready content (credits / subscription). A
// `reserved` subset is held back from the library to drip into Radar over time.
// Before serving a stored winner its score is RE-CHECKED that day (freshness),
// because a past winner can decay — quality must hold.
export const winners = sqliteTable(
  'winners',
  {
    id: text('id').primaryKey(),
    normalizedKey: text('normalized_key').notNull(),
    keyword: text('keyword').notNull(),
    productTitle: text('product_title').notNull(),
    imageUrlsJson: text('image_urls_json').notNull(),
    supplierProvider: text('supplier_provider').notNull(),
    supplierProductId: text('supplier_product_id').notNull(),
    supplierCostCents: integer('supplier_cost_cents').notNull(),
    supplierProductUrl: text('supplier_product_url'),
    ebaySoldCount: integer('ebay_sold_count').notNull(),
    ebayMedianPriceCents: integer('ebay_median_price_cents').notNull(),
    marginCents: integer('margin_cents').notNull(),
    marginPercent: real('margin_percent').notNull(),
    score: real('score').notNull(),
    // List-ready AI content, so an unlock yields an instantly-listable product.
    generatedTitle: text('generated_title').notNull(),
    generatedDescription: text('generated_description').notNull(),
    generatedAspectsJson: text('generated_aspects_json').notNull(),
    reserved: integer('reserved').notNull().default(0), // held back for the Radar drip
    timesUnlocked: integer('times_unlocked').notNull().default(0),
    lastScoredAt: integer('last_scored_at').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({
    normalizedKeyUnique: uniqueIndex('winners_normalized_key_unique').on(t.normalizedKey),
  }),
);

// Daily score snapshots per winner — powers the leaderboard's moving charts
// (sparklines + ↑/↓ rank/score deltas). At most one row per winner per UTC day.
export const winnerScoreHistory = sqliteTable(
  'winner_score_history',
  {
    id: text('id').primaryKey(),
    winnerId: text('winner_id')
      .notNull()
      .references(() => winners.id),
    score: real('score').notNull(),
    ebaySoldCount: integer('ebay_sold_count').notNull(),
    marginCents: integer('margin_cents').notNull(),
    capturedAt: integer('captured_at').notNull(),
  },
  (t) => ({
    winnerCapturedIdx: index('winner_score_history_winner_idx').on(t.winnerId, t.capturedAt),
  }),
);

// Which library winners a user has unlocked (so re-viewing is free and we can
// show "unlocked"). One row per (user, winner).
export const winnerUnlocks = sqliteTable(
  'winner_unlocks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    winnerId: text('winner_id')
      .notNull()
      .references(() => winners.id),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    userWinnerUnique: uniqueIndex('winner_unlocks_user_winner_unique').on(t.userId, t.winnerId),
  }),
);

// Anti-abuse: each external seller/supplier account (eBay, AliExpress, CJ) may
// bind to exactly ONE platform account, permanently — so trial credits can't be
// farmed by cycling dummy signups (real verified eBay seller accounts are hard
// to mass-create). The binding PERSISTS even after a user disconnects, so it
// can't be recycled. Unique on (provider, externalId). Enforcement is skipped
// in mock/sandbox mode so it doesn't block internal testing.
export const externalAccountLinks = sqliteTable(
  'external_account_links',
  {
    id: text('id').primaryKey(),
    provider: text('provider', { enum: ['ebay', 'aliexpress', 'cj'] }).notNull(),
    externalId: text('external_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    firstLinkedAt: integer('first_linked_at').notNull(),
  },
  (t) => ({
    providerExternalUnique: uniqueIndex('external_account_links_provider_external_unique').on(t.provider, t.externalId),
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

// Product Radar — GLOBAL market-research data (not per-user). Written by an
// external GitHub Actions crawler via the token-authed POST /ingest/radar
// endpoint (Workers can't run long IP-rotated crawls), and read back by any
// authenticated user on the /radar tab. The Worker recomputes per-seller margin
// at read time from the raw signals here + that user's sellerSettings, so this
// table stays user-agnostic. See DECISIONS.md.
export const radarProducts = sqliteTable('radar_products', {
  id: text('id').primaryKey(),
  niche: text('niche').notNull(),
  productTitle: text('product_title').notNull(),
  imageUrl: text('image_url'),
  // eBay demand/competition signals (from the crawler's sold + active fetch).
  ebaySoldCount: integer('ebay_sold_count').notNull().default(0),
  salesPerDay: real('sales_per_day').notNull().default(0),
  ebayActiveCount: integer('ebay_active_count').notNull().default(0),
  sellThroughPercent: real('sell_through_percent').notNull().default(0),
  ebayMedianSoldPriceCents: integer('ebay_median_sold_price_cents').notNull().default(0),
  // AliExpress supplier cross-check (nullable — a product may be un-sourceable).
  aliexpressProductId: text('aliexpress_product_id'),
  aliexpressUrl: text('aliexpress_url'),
  aliexpressCostCents: integer('aliexpress_cost_cents'),
  aliexpressRating: real('aliexpress_rating'),
  aliexpressOrders: integer('aliexpress_orders'),
  sourceable: integer('sourceable').notNull().default(0),
  // Crawler-computed economics (default eBay fee) — the read API overrides
  // margin with the viewing seller's own fee/shipping settings.
  marginCents: integer('margin_cents').notNull().default(0),
  marginPercent: real('margin_percent').notNull().default(0),
  opportunityScore: real('opportunity_score').notNull().default(0),
  // Supplier cross-check state: 'ok' (checked, result in the aliexpress_* cols),
  // 'pending' (demand strong but the Apify budget deferred the check — resumes
  // next crawl), 'none' (not checked / not applicable).
  supplierCheck: text('supplier_check', { enum: ['ok', 'pending', 'none'] })
    .notNull()
    .default('none'),
  lastUpdated: integer('last_updated').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Supplier-lookup cache — keyed on the crawler's NORMALIZED query so equivalent
// phrasings ("iphone 15 case clear" / "clear case iphone 15") share one entry
// and are never paid for twice. A row with `matchJson` null but a fresh
// `lastChecked` means "checked, no supplier found" (so we don't re-query dead
// products). The crawler reads/writes this via the token-authed
// /ingest/radar/supplier/* endpoints (Actions can't touch D1 directly).
export const supplierCache = sqliteTable('supplier_cache', {
  normalizedKey: text('normalized_key').primaryKey(),
  matchJson: text('match_json'),
  sourceable: integer('sourceable').notNull().default(0),
  lastChecked: integer('last_checked').notNull(),
});

// Monthly Apify result-consumption counter (the crawler's hard credit ceiling).
// One row per calendar month (YYYY-MM). Server-authoritative because Actions
// runners are ephemeral and can't keep a reliable local count.
export const apifyUsage = sqliteTable('apify_usage', {
  monthKey: text('month_key').primaryKey(),
  resultsConsumed: integer('results_consumed').notNull().default(0),
});

// Observability for each crawl batch the ingest endpoint receives.
export const radarRuns = sqliteTable(
  'radar_runs',
  {
    id: text('id').primaryKey(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    itemsWritten: integer('items_written').notNull().default(0),
    status: text('status', { enum: ['running', 'done', 'failed'] })
      .notNull()
      .default('running'),
  },
  (t) => ({
    statusCheck: check('radar_runs_status_check', sql`${t.status} in ('running', 'done', 'failed')`),
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
