import { readFileSync } from 'node:fs';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  // eBay Browse API (production keyset — real market data). Client-credentials
  // OAuth, so only the app key/secret are needed (no per-user token).
  ebayClientId: required('EBAY_CLIENT_ID'),
  ebayClientSecret: required('EBAY_CLIENT_SECRET'),
  // `||` not `??`: GitHub Actions passes UNSET repo variables as an empty string
  // (not undefined), which `??` wouldn't catch — that left the base URL empty
  // and broke the OAuth call. `||` falls back on '' too.
  ebayApiBase: process.env.EBAY_API_BASE || 'https://api.ebay.com',
  ebayMarketplaceId: process.env.EBAY_MARKETPLACE_ID || 'EBAY_US',

  // Where finished results go (the sourcing-portal ingest endpoint).
  ingestUrl: required('RADAR_INGEST_URL'),
  ingestToken: required('RADAR_INGEST_TOKEN'),

  apifyToken: process.env.APIFY_TOKEN || undefined,
  apifyEbaySoldActorId: process.env.APIFY_EBAY_SOLD_ACTOR_ID || 'caffein.dev~ebay-sold-listings',
  // Confirmed-SOLD velocity via Apify is OFF by default — the free Apify tier
  // can't sustain it, so demand is derived from the free eBay Browse API
  // (competition + price) instead. Set USE_APIFY_SOLD=true to re-enable real
  // sold-velocity if you top up Apify or get Marketplace Insights approval.
  useApifySold: (process.env.USE_APIFY_SOLD || 'false').toLowerCase() === 'true',

  // Optional: AliExpress Affiliate API (signed) for supplier cost/match. Without
  // it, products are marked not-sourceable (still useful as a demand radar).
  aliexpressAppKey: process.env.ALIEXPRESS_APP_KEY || undefined,
  aliexpressAppSecret: process.env.ALIEXPRESS_APP_SECRET || undefined,

  // Assumed default eBay final-value fee for the crawler's provisional margin.
  // The portal recomputes margin per-seller, so this is only a sort seed.
  defaultEbayFeePercent: Number(process.env.DEFAULT_EBAY_FEE_PERCENT ?? '13.25'),

  // How many active listings to sample per niche for price/competition.
  sampleLimit: Number(process.env.SAMPLE_LIMIT ?? '50'),

  // ── LLM niche generation (Groq) — the crawler picks its own specific niches ──
  // instead of a hand-maintained seed list. Absent key → falls back to seeds.json.
  groqApiKey: process.env.GROQ_API_KEY || undefined,
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  // How many niches the LLM proposes (and we crawl) per run. Bounded because
  // each niche costs an (uncapped) eBay sold-data call — keep it modest on a
  // free Apify account.
  maxNiches: Number(process.env.MAX_NICHES || '6'),
  // Optional broad areas to steer the LLM (comma-separated). Empty = open-ended.
  seedThemes: (process.env.SEED_THEMES || '').split(',').map((s) => s.trim()).filter(Boolean),

  // ── Supplier-lookup credit discipline (see src/supplier/ + README) ──────────
  // The supplier module may be called with at most this many survivors per run.
  topNSurvivors: Number(process.env.TOP_N_SURVIVORS ?? '30'),
  // Skip an Apify call entirely if a cached result is younger than this.
  cacheTtlDays: Number(process.env.CACHE_TTL_DAYS ?? '10'),
  // Results requested per supplier lookup (the Apify billing unit). NOTE: the
  // AliExpress-products actor has a ~50 floor, so real consumption may exceed
  // this until we switch to the Affiliate API (no per-result cost).
  maxItemsPerLookup: Number(process.env.MAX_ITEMS_PER_LOOKUP ?? '8'),
  // Hard monthly ceiling of Apify RESULTS. Set BELOW the free credit. Once
  // crossed, remaining survivors are marked supplier_check:"pending".
  apifyMonthlyResultBudget: Number(process.env.APIFY_MONTHLY_RESULT_BUDGET ?? '1000'),
  // AliExpress product-search actor (Apify supplier provider).
  apifyAliexpressActorId: process.env.APIFY_ALIEXPRESS_ACTOR_ID ?? 'devcake~aliexpress-products-scraper',
  // Abort a supplier lookup after this long so a stuck run can't burn credit.
  supplierTimeoutMs: Number(process.env.SUPPLIER_TIMEOUT_MS ?? '45000'),
};

/** Seed niches to research. Override with a seeds.json (array of strings) or the
 * SEEDS env var (comma-separated). */
export function loadSeeds(): string[] {
  if (process.env.SEEDS) {
    return process.env.SEEDS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  try {
    const raw = readFileSync(new URL('../seeds.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // fall through to default
  }
  return ['phone accessories', 'pet supplies', 'kitchen gadgets', 'car accessories', 'fitness gear'];
}
