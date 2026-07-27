export interface Env {
  // Bindings
  SOURCING_DB: D1Database;
  ASSETS: Fetcher;

  // Vars
  MOCK_MODE: string;
  ENVIRONMENT: string;

  // App-level secrets (shared product credentials, not per-customer)
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  GEMINI_EMBEDDING_MODEL?: string;
  APIFY_TOKEN?: string;
  APIFY_EBAY_SOLD_ACTOR_ID?: string;
  APIFY_ALIEXPRESS_ACTOR_ID?: string;

  // Free-stack research sources (replace Apify in the Research pipeline):
  // ScraperAPI for eBay demand (items_sold), AliExpress Dropshipper API for
  // supplier cost/match. AliExpress uses the PLATFORM token for discovery
  // (access minted from the refresh token); per-user connect is for fulfillment.
  SCRAPER_API_KEY?: string;
  ALIEXPRESS_APP_KEY?: string;
  ALIEXPRESS_APP_SECRET?: string;
  ALIEXPRESS_REFRESH_TOKEN?: string;
  ALIEXPRESS_ACCESS_TOKEN?: string;

  // eBay app credentials — used for OAuth token exchange/refresh, the Browse
  // API (active-listing search), the Taxonomy API (category suggest), and the
  // Trading API (AddFixedPriceItem). These are the PRODUCT's app keyset; each
  // seller's own OAuth token is stored per-user (encrypted) in ebay_connections.
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_RUNAME?: string;
  EBAY_API_BASE_URL?: string;
  // eBay's OAuth *consent* host (where the seller signs in), separate from the
  // API base above. Defaults to production `https://auth.ebay.com`; set to
  // `https://auth.sandbox.ebay.com` to run the connect flow against sandbox.
  EBAY_AUTH_BASE_URL?: string;
  EBAY_MARKETPLACE_ID?: string;
  // Shared secret for eBay's Marketplace Account Deletion webhook challenge
  // (see routes/webhooks.ebay-deletion.ts). Set on the keyset's notification
  // config in the eBay developer portal and via `wrangler secret put`.
  EBAY_DELETION_VERIFICATION_TOKEN?: string;

  // CJ default base url (per-user token stored in supplier_connections).
  CJ_BASE_URL?: string;

  // Shared bearer secret the external Product Radar crawler (GitHub Actions)
  // must present to POST results to /ingest/radar. Set via `wrangler secret put`.
  RADAR_INGEST_TOKEN?: string;

  // Shared secret for service-to-service calls from the trackzy worker (e.g. the
  // fulfillment-charge meter). Set on both workers via `wrangler secret put`.
  INTERNAL_SERVICE_TOKEN?: string;

  // Lemon Squeezy (merchant-of-record) billing. API key + store id create
  // checkouts; the webhook secret verifies inbound events. Variant ids come
  // from the LS dashboard once products exist (billing stays disabled until set).
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  LS_VARIANT_CREDITS_50?: string;
  LS_VARIANT_CREDITS_200?: string;
  LS_VARIANT_CREDITS_600?: string;
  LS_VARIANT_SUB_PRO?: string;

  // The trackzy linkage: base URL of the trackzy worker, called best-effort
  // after a listing publishes so trackzy can fulfill it with a deterministic
  // supplier match. Optional — fulfillment degrades to trackzy's own matching.
  TRACKZY_BASE_URL?: string;
}
