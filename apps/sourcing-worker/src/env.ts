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

  // eBay app credentials — used for OAuth token exchange/refresh, the Browse
  // API (active-listing search), the Taxonomy API (category suggest), and the
  // Trading API (AddFixedPriceItem). These are the PRODUCT's app keyset; each
  // seller's own OAuth token is stored per-user (encrypted) in ebay_connections.
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_RUNAME?: string;
  EBAY_API_BASE_URL?: string;
  EBAY_MARKETPLACE_ID?: string;

  // CJ default base url (per-user token stored in supplier_connections).
  CJ_BASE_URL?: string;

  // The trackzy linkage: base URL of the trackzy worker, called best-effort
  // after a listing publishes so trackzy can fulfill it with a deterministic
  // supplier match. Optional — fulfillment degrades to trackzy's own matching.
  TRACKZY_BASE_URL?: string;
}
