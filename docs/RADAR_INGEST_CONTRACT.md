# Product Radar — ingest contract (for the crawler repo)

The **Product Radar** feature is split across two repos:

- **This repo (`sourcing-portal`)** — owns the D1 table, the read UI (`/radar`), and the
  token-authed ingest endpoint. Already implemented and deployed.
- **A separate crawler repo (GitHub Actions cron)** — does the eBay sold+active fetch, AliExpress
  supplier cross-check, scoring, and **POSTs results here**. Build it against this contract.

Workers can't run long, throttled, IP-rotated crawls, so the crawler lives outside and only hands
finished results to the Worker, which stores and renders them.

## Endpoint

```
POST https://sourcing-portal.zainey4-26a.workers.dev/ingest/radar
Authorization: Bearer <RADAR_INGEST_TOKEN>
Content-Type: application/json
```

- `RADAR_INGEST_TOKEN` is a shared secret set on the Worker (`wrangler secret put RADAR_INGEST_TOKEN`).
  Store the same value as a **GitHub Actions secret** in the crawler repo. A wrong/missing token → `401`.
- Not Clerk-authenticated (a CI job has no user session) — the bearer token is the only guard.

## Request body

```jsonc
{
  "mode": "replace",   // "replace" (default) swaps the whole table for this snapshot;
                        // "upsert" updates/inserts by `id`, leaving other rows in place.
  "items": [ RadarItem, ... ]   // max 2000 per request
}
```

### `RadarItem`

| field | type | required | notes |
|---|---|---|---|
| `id` | string | no | Stable key. Omit and the Worker assigns a ULID. **Provide a stable id if using `upsert`.** |
| `niche` | string | **yes** | The seed/niche this product was found under. |
| `productTitle` | string | **yes** | Human product title. |
| `imageUrl` | string (url) | no | Primary image. `null` allowed. |
| `ebaySoldCount` | int ≥0 | no (def 0) | Confirmed sold count over the crawl window. |
| `salesPerDay` | number ≥0 | no (def 0) | Velocity. |
| `ebayActiveCount` | int ≥0 | no (def 0) | Competing active listings. |
| `sellThroughPercent` | number ≥0 | no (def 0) | STR, e.g. sold / (sold + active) × 100. |
| `ebayMedianSoldPriceCents` | int ≥0 | no (def 0) | Median sold price, **in cents**. |
| `aliexpressProductId` | string | no | `null` if not sourceable. |
| `aliexpressUrl` | string (url) | no | `null` if not sourceable. |
| `aliexpressCostCents` | int ≥0 | no | Landed supplier cost **in cents**. `null` if unknown. |
| `aliexpressRating` | number | no | Supplier/product rating. |
| `aliexpressOrders` | int ≥0 | no | Supplier order count. |
| `sourceable` | boolean or 0/1 | no | Whether a supplier match was found. |
| `supplierCheck` | `"ok"` \| `"pending"` \| `"none"` | no | Supplier cross-check state. `pending` = demand strong but the monthly Apify budget deferred the check; the UI shows "supplier check pending" and it resumes next crawl. Default `none`. |
| `marginCents` | int | no (def 0) | Crawler's margin using a **default** eBay fee. The read API **recomputes** this per-seller from their own fee settings, so it's only a fallback/sort seed. |
| `marginPercent` | number | no (def 0) | Same caveat. |
| `opportunityScore` | number | no (def 0) | Ranking score (margin × velocity, competition-adjusted). Default sort key in the UI. |

All money is **integer cents**. Optional fields accept `null` or omission.

### Response

```jsonc
{ "ok": true, "mode": "replace", "itemsWritten": 42, "runId": "01K..." }   // 200
{ "error": { "code": "UNAUTHORIZED", "message": "..." } }                   // 401
{ "error": { "code": "VALIDATION_ERROR", "message": "..." } }              // 400 (zod detail)
{ "error": { "code": "INGEST_FAILED", "message": "..." } }                 // 500
```

Each call records a row in `radar_runs` (`startedAt`, `finishedAt`, `itemsWritten`, `status`) for
observability.

## Supplier cache + budget endpoints (crawler credit discipline)

Because a GitHub Actions runner can't reach D1 directly, the supplier-lookup
cache and the monthly Apify ceiling live in the portal's D1, exposed on the same
`RADAR_INGEST_TOKEN`-guarded router. The crawler calls these before/after any
paid Apify supplier lookup.

```
POST /ingest/radar/supplier/lookup
  body: { "keys": string[], "ttlDays"?: number (default 10) }
  resp: { "hits": { "<normalizedKey>": { "match": SupplierMatch | null } }, "monthUsage": number }
```
Returns only FRESH cache hits (checked within `ttlDays`). A present key with
`match: null` = "checked, no supplier found" (don't re-query). Absent keys are
misses the crawler resolves via Apify, subject to the budget. `monthUsage` is
this calendar month's consumed Apify results.

```
POST /ingest/radar/supplier/store
  body: { "entries": [ { "key": string, "match": SupplierMatch | null, "resultsConsumed"?: number } ] }
  resp: { "monthUsage": number }
```
Upserts cache rows and increments this month's counter by the total
`resultsConsumed`. `SupplierMatch` = `{ productId, url, costCents, rating?, orders?, imageUrl? }`.

The crawler owns `APIFY_MONTHLY_RESULT_BUDGET`; the server owns the authoritative
counter. Once `monthUsage + maxItems > budget`, the crawler stops calling Apify
and marks remaining survivors `supplierCheck: "pending"`.

## How the Worker uses it

- `GET /api/radar` (Clerk-protected) returns all rows ranked by `opportunityScore`, with
  **`marginCents`/`marginPercent` recomputed** from `ebayMedianSoldPriceCents − aliexpressCostCents`
  and the viewing seller's `ebayFeePercent` (via `computeListingMargin`). `sourceable` is returned as a
  boolean. The `/radar` React tab sorts/filters client-side (margin × velocity, sell-through, min
  margin, sourceable-only).

## Recommended crawler data sources (avoid the anti-bot walls)

GitHub Actions uses datacenter IPs, which eBay (Akamai) and AliExpress CAPTCHA-wall. Prefer APIs:

- **eBay active listings + pricing:** eBay **Browse API** (client-credentials OAuth — the keyset already
  has it). Free.
- **eBay confirmed-sold data:** no free official route (Marketplace Insights is gated). Use a paid
  sold-data source (e.g. Apify) or an approved Insights key.
- **AliExpress supplier match/cost:** the **Affiliate API** (`aliexpress.affiliate.product.query`,
  signed AppKey/AppSecret — no CAPTCHA), not website scraping.

## Example

```bash
curl -X POST "$BASE/ingest/radar" \
  -H "Authorization: Bearer $RADAR_INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"mode":"replace","items":[
    {"niche":"phone accessories","productTitle":"MagSafe Car Mount",
     "ebaySoldCount":184,"salesPerDay":6.1,"ebayActiveCount":52,"sellThroughPercent":78,
     "ebayMedianSoldPriceCents":1699,"aliexpressProductId":"AE100",
     "aliexpressUrl":"https://www.aliexpress.com/item/100.html","aliexpressCostCents":320,
     "sourceable":true,"opportunityScore":81}
  ]}'
```
