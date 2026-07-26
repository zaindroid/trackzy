# Zearch Radar Crawler

The external data source for **Zearch Engine's Product Radar**. It finds products with real eBay
demand + competition, cross-checks an AliExpress supplier, scores them, and **POSTs the results** to
the `sourcing-portal` app's ingest endpoint. It runs as a **GitHub Actions cron** because Cloudflare
Workers can't do long, throttled, IP-rotated crawls.

```
GitHub Actions cron  ──►  eBay Browse API (active + price)
                          + Apify sold data (optional, velocity)
                          + AliExpress Affiliate API (optional, supplier cost)
                          ──►  score  ──►  POST /ingest/radar  ──►  D1  ──►  /radar tab
```

The full request contract lives in the portal repo: `docs/RADAR_INGEST_CONTRACT.md`.

## Data sources (why these)

GitHub Actions runners use datacenter IPs, which eBay (Akamai) and AliExpress CAPTCHA-wall. So this
uses **APIs, not scraping**:

| Signal | Source | Status |
|---|---|---|
| Active listings + price + competition | **eBay Browse API** (client-credentials) | ✅ works now, free |
| Confirmed sold count / velocity | **Apify** sold-listings actor (optional) | ⚙️ set `APIFY_TOKEN` to enable |
| Supplier match + cost | **AliExpress Affiliate API** (signed, optional) | ⚙️ set `ALIEXPRESS_APP_KEY/SECRET` |

Without the optional ones, Radar still works — you get eBay demand/competition signals; velocity is 0
and products show as not-sourceable until you add the keys. There is **no free official eBay
sold-data API** (Marketplace Insights is gated), so velocity needs Apify or an approved Insights key.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill it in (at minimum: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`,
   `RADAR_INGEST_URL`, `RADAR_INGEST_TOKEN`).
3. Run locally: `npm run crawl`

### GitHub Actions secrets/vars

Add these in the repo's **Settings → Secrets and variables → Actions**:

**Secrets:** `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `RADAR_INGEST_URL`, `RADAR_INGEST_TOKEN`, and
optionally `APIFY_TOKEN`, `ALIEXPRESS_APP_KEY`, `ALIEXPRESS_APP_SECRET`.

**Variables (optional):** `EBAY_API_BASE` (default `https://api.ebay.com`), `EBAY_MARKETPLACE_ID`
(default `EBAY_US`), `SEEDS` (comma-separated niches; otherwise `seeds.json` is used).

The cron in `.github/workflows/crawl.yml` runs daily and can be triggered manually from the Actions tab.

## Niche discovery — the LLM picks the seeds (`src/seeds/llm.ts`)

Instead of a hand-maintained seed list, the crawler asks **Groq** to propose
`MAX_NICHES` *specific, long-tail* product niches each run (e.g. "magnetic vent
car phone mount", not "phone mount") — broad heads score badly on competition,
so specificity is the main quality lever. Output varies run-to-run, so Radar
keeps discovering fresh opportunities without you touching seeds. `SEED_THEMES`
optionally steers it toward areas you care about. Without `GROQ_API_KEY` it
falls back to `seeds.json`.

Because each niche costs an (uncapped) eBay sold-data call, `MAX_NICHES`
(default 6) bounds the per-run spend, sold-data sample size is kept small, and
the cron defaults to **weekly** — see the credit strategy below.

## Supplier lookup — free-tier credit strategy (`src/supplier/`)

AliExpress supplier cross-checks are the ONE place this crawler can spend money
(Apify, pay-per-result, one free account ~$5/mo, no rotation). The supplier layer
is designed so most nightly runs cost **zero**. Apify is the narrow bottom of the
funnel — it is only ever called for *survivors* (products that already passed eBay
scoring), never the broad keyword universe.

`resolveSuppliers(survivors, { provider, cache, config })` applies, in order:

1. **Survivor-only gate** — hard-capped at `TOP_N_SURVIVORS` (default 30). The
   module physically won't process more, so a scoring bug can't dump the whole
   universe into Apify.
2. **Query normalization + dedupe** — `normalizeQuery` lowercases, strips
   marketing words, and sorts tokens, so `"iPhone 15 Case Clear"` and
   `"clear case iphone 15"` share one cache key and are never paid for twice.
3. **D1 cache with slow re-check** — one batch `lookup` to the portal; keys
   checked within `CACHE_TTL_DAYS` (default 10) skip Apify entirely. Steady-state
   nightly runs make **zero** new calls because survivors are already cached.
4. **Low `maxItems`** — only `MAX_ITEMS_PER_LOOKUP` results requested per call
   (default 8). *Caveat:* the AliExpress-products actor has a ~50 floor, so real
   consumption may exceed this until the Affiliate API provider (no per-result
   cost) is wired — see the stub.
5. **Sync call + tight timeout** — `run-sync-get-dataset-items` with an
   `AbortController` (`SUPPLIER_TIMEOUT_MS`, default 45s) so a stuck run can't
   silently burn credit.
6. **Self-imposed monthly ceiling** — the portal keeps a server-authoritative
   per-month result counter. Once `usage + maxItems > APIFY_MONTHLY_RESULT_BUDGET`
   (default 1000, set BELOW the free credit), the crawler stops calling Apify and
   marks remaining survivors `supplierCheck: "pending"`. The run still completes
   and posts everything — pending products show as "demand strong, supplier not
   yet checked" and are picked up automatically next month / after a top-up.

**Providers are pluggable** (`SupplierProvider`): `ApifyAliexpressProvider` is
active now; `AffiliateSupplierProvider` is a stub — swapping the primary to the
(cost-free, no-CAPTCHA) AliExpress Affiliate API is one line in `index.ts`.

### Config knobs

| Env | Default | Meaning |
|---|---|---|
| `TOP_N_SURVIVORS` | 30 | Max survivors the supplier layer will process per run. |
| `CACHE_TTL_DAYS` | 10 | Cached supplier results younger than this skip Apify. |
| `MAX_ITEMS_PER_LOOKUP` | 8 | Results requested per Apify call (billing unit). |
| `APIFY_MONTHLY_RESULT_BUDGET` | 1000 | Hard monthly result ceiling; set below the free credit. |
| `SUPPLIER_TIMEOUT_MS` | 45000 | Abort a stuck lookup. |
| `APIFY_TOKEN` | — | From Actions secret. Absent → cache-only, all misses `pending`. |

Tests (`src/supplier/lookup.test.ts`) prove: cached survivors make **no** Apify
call, the ceiling halts calls and marks `pending`, and dedupe collapses
equivalent queries to one paid call.

## Notes / TODO(HUMAN)

- **eBay keyset:** use a **production** keyset for real market data (the portal's sandbox keyset returns
  sandbox listings). Any production client-credentials keyset works for Browse.
- **AliExpress signing** (`src/aliexpress.ts`) is scaffolded to the TOP `md5` scheme; confirm the exact
  method/params/response shape against your approved API version before relying on it.
- `mode: "replace"` in `src/ingest.ts` swaps the whole Radar table each run. Switch to `"upsert"` (with
  stable `id`s) if you'd rather accumulate across runs.
