# Deploying Fulfillment Tracker

Everything below assumes `pnpm install` has already been run at the repo root. All local
development and testing runs in `MOCK_MODE=true` with zero real credentials — nothing here is
required to run `pnpm dev` or `pnpm test`. It's only needed to point a deployment at real Shopify /
Gemini / 17TRACK / Clerk accounts.

Every step below that requires a human to click through a console or register an account is
tagged **TODO(HUMAN)**, matching the `// TODO(HUMAN): ...` comments left in the code at the exact
spot that consumes the resulting value.

## 0. One-time Cloudflare account setup

**TODO(HUMAN)**: If you don't already have one, create a Cloudflare account and install/authenticate
Wrangler: `pnpm exec wrangler login` (run from `apps/worker/`, or pass `--config ../../wrangler.toml`
from the repo root). Free tier is sufficient for everything in this project — D1, Queues, Workflows,
Workers Assets, and Email Routing are all zero-cost at this scale.

## 1. Create the D1 database

**TODO(HUMAN)**:
```
pnpm --filter @fulfillment-tracker/worker exec wrangler d1 create fulfillment-tracker-db --config ../../wrangler.toml
```
Copy the returned `database_id` into `wrangler.toml`'s `[[d1_databases]]` block, replacing
`PLACEHOLDER__D1_DATABASE_ID`.

Then run migrations and seed the demo dataset (optional in production, useful for a staging
environment):
```
pnpm db:migrate:prod
pnpm --filter @fulfillment-tracker/worker exec wrangler d1 execute DB --remote --file=../../packages/db/seed.sql --config ../../wrangler.toml
```

## 2. Create the Queues

**TODO(HUMAN)**:
```
pnpm --filter @fulfillment-tracker/worker exec wrangler queues create order-events --config ../../wrangler.toml
pnpm --filter @fulfillment-tracker/worker exec wrangler queues create order-events-dlq --config ../../wrangler.toml
```
`wrangler.toml` already declares the producer/consumer bindings; these commands just provision the
underlying queues in your account (D1 and Workflows are auto-provisioned on first `wrangler deploy`
from the `[[d1_databases]]` / `[[workflows]]` blocks, but Queues currently must be created explicitly).

## 3. Shopify app

**TODO(HUMAN)**: In the [Shopify Partner Dashboard](https://partners.shopify.com/) (or your store's
custom-app admin at `https://<shop>.myshopify.com/admin/settings/apps/development`):
1. Create an app (custom app is fine for a single storefront).
2. Grant Admin API scopes: `read_orders`, `write_fulfillments`, `read_fulfillments`.
3. Install the app on your store and copy the Admin API access token.
4. Under **Settings → Notifications → Webhooks** (or via the Admin API), register a webhook for the
   `orders/create` topic pointing at `https://<your-worker>.workers.dev/webhooks/shopify`. Shopify
   generates a webhook signing secret at this point — copy it.
5. Set the secrets on the deployed Worker:
   ```
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put SHOPIFY_ACCESS_TOKEN --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put SHOPIFY_WEBHOOK_SECRET --config ../../wrangler.toml
   ```
6. Insert a row into the `storefronts` table (via `wrangler d1 execute ... --remote`) with your real
   `shop_domain`, and `access_token_ref` / `webhook_secret_ref` set to `env:SHOPIFY_ACCESS_TOKEN` /
   `env:SHOPIFY_WEBHOOK_SECRET` (this demo's single-tenant convention — see DECISIONS.md).
7. Finally set `MOCK_MODE = "false"` in `wrangler.toml`'s `[vars]` block once real secrets are wired,
   or per-environment via `wrangler.toml` `[env.production.vars]` if you want mock and prod to coexist.

## 4. Cloudflare Email Routing (inbound supplier tracking emails)

**TODO(HUMAN)**: In the Cloudflare dashboard, under your zone → **Email → Email Routing**:
1. Enable Email Routing for the domain you'll receive supplier emails at.
2. Add a routing rule: match address (e.g. `orders@yourdomain.com`) → **Send to a Worker** →
   select this Worker (it must already be deployed once before it shows up as a target).
3. No `wrangler.toml` binding is needed for the inbound side — the Worker's `email()` export in
   `apps/worker/src/email.ts` is invoked directly by Email Routing. The `[[send_email]]` binding in
   `wrangler.toml` (`DISPUTE_EMAIL`) is for *outbound* dispute-reply sending only, and requires a
   verified sending domain under the same Email Routing section before real sends will succeed
   (see the placeholder note in step 6 below).
4. Point your suppliers' shipping-notification emails (or a forwarding rule from your real inbox) at
   this address.

## 5. Google Gemini (embeddings) + Groq (everything else)

**Split across two providers** (see DECISIONS.md for why): Gemini's free tier turned out to be too
tight for even light production use (20 `generate_content` requests/day) — everything that used to be
a Gemini chat call now runs on Groq instead, whose free tier (14,400 requests/day) has real headroom.
Gemini has no substitute for embeddings though (Groq doesn't offer an embeddings API at all), so
`embedText` — the SKU/listing match cascade's cosine-similarity stage — stays on Gemini, whose
`embedContent` quota is tracked separately and wasn't the thing that ran out.

**TODO(HUMAN)**: Create a Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey), and
a Groq API key at [console.groq.com/keys](https://console.groq.com/keys). Set both:
```
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put GEMINI_API_KEY --config ../../wrangler.toml
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put GROQ_API_KEY --config ../../wrangler.toml
```
Both are required — `createGeminiExtractor` falls back to its mock unless both `GEMINI_API_KEY` and
`GROQ_API_KEY` look real (same multi-secret gate convention as eBay's `CLIENT_ID`+`CLIENT_SECRET`).
Called from exactly five chat/JSON places (hard architectural rule, unchanged by the Groq move) —
email-extraction fallback, dispute-email drafting, SKU/listing matching (ambiguous cases only), carrier
exception triage (ambiguous cases only), and listing title optimization — never in the margin/pricing
path. `embedText` (SKU/listing matching's embedding-similarity stage) is a sixth, separate call not
counted among those five since it's not itself a decision, just a vector.

## 6. 17TRACK API key

**TODO(HUMAN)**: Register for API access at [17TRACK](https://features.17track.net/en/api). Set:
```
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put SEVENTEENTRACK_API_KEY --config ../../wrangler.toml
```
Then register each tracking number your suppliers ship (the app does this automatically via
`packages/adapters/src/seventeentrack` whenever a fulfillment's carrier is confidently detected), and
configure a webhook push destination in the 17TRACK dashboard pointing at
`https://<your-worker>.workers.dev/webhooks/17track`.

**Note on webhook signing**: 17TRACK's public docs do not clearly specify an HMAC signing scheme for
push-notification webhooks the way Shopify does. `apps/worker/src/routes/webhooks.tracking.ts`
implements HMAC-SHA256 verification against a shared secret (reusing `SEVENTEENTRACK_API_KEY`) as a
reasonable default consistent with this project's "every webhook is HMAC-verified" hard rule.
**TODO(HUMAN)**: confirm the exact signature header/algorithm 17TRACK's dashboard actually sends for
your account tier once you have one, and adjust `verifyHmacSha256`'s inputs in that route if it
differs.

## 7. Clerk (dashboard auth)

**TODO(HUMAN)**: Create an application at [clerk.com](https://dashboard.clerk.com/), then:
```
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put CLERK_SECRET_KEY --config ../../wrangler.toml
```
The publishable key is not secret — set it as a build-time env var for the dashboard
(`apps/dashboard/.env.production`: `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`) before running
`pnpm build`. Once `VITE_CLERK_PUBLISHABLE_KEY` is a real (non-`PLACEHOLDER__`) key, the dashboard
automatically switches from the "Continue as dev user" mock login to Clerk's hosted `<SignIn />`
(which also surfaces "Sign up" — no separate config needed) (`apps/dashboard/src/lib/clerkAuth.tsx`).

**No manual `users` row needed.** `authMiddleware` (`apps/worker/src/middleware/auth.ts`) auto-
provisions a `users` row the first time a cryptographically-valid Clerk session hits any API route
with no matching row yet — this is what makes real customer self-signup work end-to-end. It fetches
the user's email from Clerk's Backend API (`fetchClerkUserEmail` in
`packages/adapters/src/clerk/real.ts`) via a raw `fetch` against `https://api.clerk.com/v1/users/:id`
— deliberately *not* `createClerkClient().users.getUser()`, because that SDK call pulls in
`snakecase-keys` -> `map-obj`, which throws `Cannot use require() to import an ES Module` under the
Workers runtime's CJS/ESM interop (this bit in both vitest-pool-workers and is a known class of issue
for real workerd too — same family as the dynamic-import workaround already used for `verifyToken`,
except this one fires at call time, not bundle time, so dynamic import alone doesn't dodge it). If
the email fetch fails for any reason, provisioning still succeeds with a `<clerk_user_id>@unknown.clerk.user`
placeholder rather than blocking signup. Auto-provisioning only runs for real (non-mock) sessions —
in mock mode any bearer string verifies as valid, so provisioning there would create a user for a
typo'd token instead of correctly rejecting it.

## 7b. Multi-tenant self-serve connections (customers connect their own accounts)

**Resolved (2026-07).** Every marketplace/supplier below used to require a developer to run each
provider's OAuth consent flow by hand and paste the resulting tokens into `wrangler secret put`.
That still works for *your own* account (sections 8–12 below), but real customers now connect their
own eBay/AliExpress/CJ accounts themselves, through the dashboard's **Connections** page — no shell
access, no secrets, no copy-pasting tokens.

**What changed under the hood** (see DECISIONS.md for the full reasoning):
- `apps/worker/src/lib/credentialCrypto.ts` — every customer-supplied OAuth token/API key is
  AES-256-GCM encrypted before it touches D1, under one master key (`CREDENTIAL_ENCRYPTION_KEY`, a
  Worker secret — **not** a customer credential itself). `resolveSecretRef` transparently decrypts
  `enc:v1:...` values alongside the existing `env:VAR_NAME` convention (your own app-level secrets,
  unaffected).
- `POST /api/connections/manual` (Amazon Retail, Temu — no credentials at all, just a Buy Queue
  supplier row), `POST /api/connections/cj` (paste a raw CJ API key, server exchanges it once), and
  `GET /api/connections/{ebay,aliexpress}/start` + the matching `/oauth/{ebay,aliexpress}/callback`
  (real OAuth, replacing the old manual copy-paste landing pages).
- A new `oauth_connect_states` table ties an OAuth provider's redirect back to the specific user who
  clicked "Connect" — necessary because a provider's callback can't carry a Bearer token the way
  every other `/api/*` route requires.

**TODO(HUMAN) — what you still need to do**: the `/start` endpoints need *your own* eBay/AliExpress
developer app credentials configured (one app, servicing every customer's individual OAuth grant —
you do **not** need a separate registered app per customer):
```
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put EBAY_CLIENT_ID --config ../../wrangler.toml
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put EBAY_CLIENT_SECRET --config ../../wrangler.toml
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put EBAY_RUNAME --config ../../wrangler.toml
```
`EBAY_RUNAME` is eBay's own redirect-URI concept — register one in the eBay Developer Portal pointing
at `https://<your-worker>.workers.dev/oauth/ebay/callback`, then set its RuName value here (not the
literal URL — see section 8's eBay Keyset setup if you haven't registered a Production keyset yet).
`ALIEXPRESS_APP_KEY`/`ALIEXPRESS_APP_SECRET` (section 11) double as this flow's AliExpress app
credentials too — no separate setup needed there. **Until these are set, the eBay/AliExpress
"Connect" buttons on the Connections page return a clear "not configured yet" error rather than
failing silently.**

Also still open: Amazon Business API isn't exposed as a self-serve option at all — it requires each
customer's own private agreement with Amazon, which can't be automated (see DECISIONS.md). Amazon
Retail (manual/Buy-Queue) covers "Amazon" for customers instead.

## 7c. One-click approval queue for api-kind supplier orders (AliExpress, CJ)

**Resolved (2026-07).** Every step of order fulfillment runs autonomously exactly as before —
margin evaluation, supplier matching, cost computation — but the actual money-spending API call to
place an order with an `api`-kind supplier (AliExpress, CJ) no longer fires immediately. It queues
in a `pending_supplier_orders` row instead, and the dashboard's **Approvals** page shows exactly what
was decided (supplier, line items, cost) with a single "Approve & place order" button — click it,
and *that* triggers the real `SupplierClient.createOrder()` call. Reject instead, and the supplier is
never contacted at all.

`manual`-kind suppliers (Amazon Retail, Temu) already had an equivalent human checkpoint for free —
a person places the order by hand via the Buy Queue — so this only needed building for the suppliers
where a real API call happens with zero human involvement today. No setup required: this is on by
default for every `api`-kind supplier, nothing to configure. `apps/worker/src/lib/placeSupplierOrder.ts`
has the full `approveSupplierOrder`/`rejectSupplierOrder` implementation, both idempotent against a
duplicate click or an already-decided row.

---

# Phase 2 — Multi-Marketplace Dropshipping Automation

Everything below is additive to Phase 1's setup above — and, as of section 7b, describes *your own*
account's setup; real customers use the Connections page instead. All of it stays mock-backed
(`MOCK_MODE=true`, or per-adapter `PLACEHOLDER__` key detection) until you actually work through
these steps — none of it is required for `pnpm dev` / `pnpm test`.

## 8. eBay (Sell APIs: Fulfillment, Inventory, Post-Order) + non-API fallback

**Resolved (2026-07):** `storefronts.platform`'s CHECK constraint on the real production database now
allows `'ebay'`/`'amazon'` as well as `'shopify'` — see DECISIONS.md's "Platform CHECK constraint
finally widened" entry for how (a coordinated, backed-up, locally-validated rebuild of `storefronts` and
every table transitively chained to it via foreign keys). A real eBay storefront row can be inserted
directly now; no further blocker here.

**TODO(HUMAN)**: Register at the [eBay Developers Program](https://developer.ebay.com/), then:
1. Create a **Keyset** (Production, once you're past sandbox testing) — this gives you
   `EBAY_CLIENT_ID` (App ID) and `EBAY_CLIENT_SECRET` (Cert ID).
2. Configure OAuth: set a redirect URI (RuName) and run eBay's 3-legged OAuth user-consent flow once,
   by hand, to obtain an initial `EBAY_OAUTH_ACCESS_TOKEN` / `EBAY_OAUTH_REFRESH_TOKEN` pair scoped to
   `https://api.ebay.com/oauth/api_scope/sell.fulfillment` and `.../sell.inventory` (the adapter
   refreshes the access token itself thereafter via `RealEbayOrderSource.ensureFreshToken()` — you only
   need to seed the *first* refresh token by hand).
3. Set secrets:
   ```
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put EBAY_CLIENT_ID --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put EBAY_CLIENT_SECRET --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put EBAY_OAUTH_ACCESS_TOKEN --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put EBAY_OAUTH_REFRESH_TOKEN --config ../../wrangler.toml
   ```
4. Insert a `storefronts` row with `platform = 'ebay'`, `oauth_access_token_ref` /
   `oauth_refresh_token_ref` pointing at the two secrets above, and `non_api_mode` set to `1` **unless**
   your eBay account is actually enrolled in the Fulfillment API's tracking-upload capability (many
   individual seller accounts are not — see the next paragraph).
5. **TODO(HUMAN)**: verify eBay's exact REST endpoint shapes for buyer messaging (Post-Order API
   `casemanagement`) and split price/quantity updates (Inventory API `offer` vs. `inventory_item`
   resources) against a live sandbox app — `packages/adapters/src/ebay/real.ts` was written to match
   eBay's public docs as closely as possible without one (see DECISIONS.md milestone 2).

**Non-API fallback (`non_api_mode = 1`)**: if tracking upload via the API isn't available to your
account, leave `non_api_mode = 1`. `pushTracking` will throw `NonApiModeError` (caught by
`trackingUploader.ts`, not an error), and the tracking number instead surfaces at
`GET /api/extension/pending-tracking-uploads` for The Edge Agent (the Chrome extension, section 12
below) to paste into eBay's own "Add tracking" page by hand.

**Order ingestion is automatic once the storefront row exists.** `apps/worker/src/marketplaceSync.ts`
polls every `ebay`/`amazon` storefront's `OrderSource.listNewOrders()` on its own cron
(`*/10 * * * *`, see `scheduled.ts`'s `MARKETPLACE_POLL_CRON`) — this didn't exist before 2026-07;
`OrderSource` was fully implemented but nothing called it. For each new order it matches every line
item's SKU against the `listings`/`supplier_offers` catalog-matching tables (section 11 below — a
listing has to actually be matched to a supplier first, or the order goes to `exception` for manual
resolution instead of guessing), evaluates margin against the real per-SKU cost, and — if it clears
your threshold — places the supplier order per matched supplier (`api` kind calls the supplier's real
API; `manual` kind, i.e. Amazon Retail/AliExpress/Temu, creates a `manual_tasks` row for the Buy Queue
instead, carrying the buyer's `shipTo` through for the extension's paste-address flow).

**Listing sync is also automatic — nothing to seed by hand.** You never need to manually insert a
`listings` row for a real customer's own account. This is read-only, matching this app's actual scope:
it never creates or publishes a listing, only reads the ones a seller already made and edits their
price/quantity/title (see the "Automated ordering" description on the Connections page and
`apps/worker/src/catalog/listingsSync.ts`'s `syncListingsForStorefront()`). A customer's existing
eBay listings sync in three ways: immediately on connect (`/oauth/ebay/callback`, best-effort — a
failure here doesn't block the connection), on a dedicated `LISTINGS_SYNC_CRON` every 2 minutes
(deliberately tighter than order polling — see DECISIONS.md), and on demand via the "Sync listings now"
button on the Connections page (`POST /api/listings/sync`). Every newly-synced listing that isn't
matched to a supplier yet is run through the `matchListing()` cascade automatically, scoped strictly to
that customer's own connected suppliers.

**eBay listings are read via the Trading API, not the REST Inventory API** (see DECISIONS.md) — the
REST Inventory API (`/sell/inventory/v1/*`) only sees listings created through its own SKU-based
workflow, which most individual sellers never use. `RealEbayOrderSource` calls the older XML Trading
API (`GetMyeBaySelling`/`ReviseFixedPriceItem`) instead, authenticated with the same OAuth user access
token via the `X-EBAY-API-IAF-TOKEN` header — no separate Auth'n'Auth token needed, no extra setup
required beyond the OAuth connect flow already in section 7b.

**A listing the auto-match cascade can't confidently resolve doesn't get stuck** — the Listings page's
"Resolve" action (`GET`/`POST /api/listings/:id/candidates` and `/:id/match`) shows a human 2-4 scored
candidate products (with photo, title, price) pulled live from your connected suppliers, to either pick
the right one or explicitly confirm "no match" — see DECISIONS.md. **TODO(HUMAN)**: the image URL field
name is an unverified guess for AliExpress (`image_url`) and Amazon Business (`imageUrl`); CJ's
(`productImage`) is commonly documented but likewise unconfirmed against a live response — check these
once you have a live search response from each and fix `packages/adapters/src/supplierApi/*/real.ts` if
they differ. Missing images just show a "No image" placeholder, never break anything. Each candidate
also links out to the actual product page on the supplier's site (`productUrl`) — AliExpress's and
Amazon's URL schemes are stable/public and trustworthy as-is; **CJ's is an unverified guess too** and
may need fixing in the same file once you can check it against a real CJ product page.

## 8b. eBay Marketplace Account Deletion/Closure notification (required to enable a Production keyset)

**Resolved (2026-07).** eBay disables every new Production keyset until this is handled, one way or
another. **We didn't take the exemption** — this system genuinely stores eBay buyer PII (name +
shipping address, flowing through `OrderSourceOrder.shipTo` into `manual_tasks.payload_json` for the
Buy Queue flow), so the exemption's "we don't process eBay user data" claim wouldn't be true. Instead,
`apps/worker/src/routes/webhooks.ebay-deletion.ts` implements the real endpoint: eBay's one-time
ownership-verification handshake (GET, `?challenge_code=...`) plus the actual deletion notification
(POST), which redacts the matching buyer's name/address out of every `manual_tasks` row tied to an
eBay storefront. `EBAY_DELETION_VERIFICATION_TOKEN` is live as a Worker secret, the endpoint URL +
token are registered in the eBay Developer Portal, eBay's ownership-verification GET passed (keyset's
compliance banner cleared), and a real "Send Test Notification" payload confirmed the handler's
`notification.data.username` field-name assumption was correct — see DECISIONS.md for the full record,
including one portal quirk (the endpoint/token fields stay greyed out until OAuth is enabled on the
keyset, unrelated to the notify-on-failure email field above them).

## 9. Amazon SP-API (orders, RDT-gated address access, feeds, listings)

**Not currently in use** for this deployment (the user's business model doesn't need Amazon as a sales
channel, only as a supplier — see section 10). The `platform='amazon'` CHECK constraint blocker
mentioned in earlier versions of this doc is resolved regardless (same fix as section 8), so this
section is ready to pick up later if that ever changes.

**TODO(HUMAN)**: Register as a [Selling Partner API developer](https://developer.amazonservices.com/)
and create a **self-authorized private application** (the correct shape for a single seller
integrating their own account, as opposed to a published third-party app — see DECISIONS.md milestone
3 for why this means no AWS SigV4 signing is needed here):
1. In Seller Central, authorize your own self-authorized app to get `AMAZON_LWA_CLIENT_ID` /
   `AMAZON_LWA_CLIENT_SECRET` and an initial `AMAZON_OAUTH_REFRESH_TOKEN` (the LWA access token is
   short-lived and refreshed automatically thereafter).
2. Note your `AMAZON_SELLER_ID` and `AMAZON_MARKETPLACE_ID` (e.g. `ATVPDKIKX0DER` for amazon.com).
3. **Request RDT (Restricted Data Token) access** under the "Restricted Data Token" section of your
   app's permissions in Seller Central — this is what lets `RealAmazonOrderSource.fetchShippingAddress()`
   call `POST /tokens/2021-03-01/restrictedDataToken` and receive PII (buyer name/address). Without
   this grant, address-fetching calls will be rejected even with a valid LWA token.
4. Set secrets:
   ```
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put AMAZON_LWA_CLIENT_ID --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put AMAZON_LWA_CLIENT_SECRET --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put AMAZON_OAUTH_REFRESH_TOKEN --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put AMAZON_SELLER_ID --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put AMAZON_MARKETPLACE_ID --config ../../wrangler.toml
   ```
5. Insert a `storefronts` row with `platform = 'amazon'` and the matching `oauth_*_ref` pointers.
6. **TODO(HUMAN)**: verify the Listings Items API's exact `purchasable_offer`/`fulfillment_availability`
   JSON Patch shapes against your product type's real schema (they vary by category) before relying on
   `listListings`/`updateListing` in production — see DECISIONS.md milestone 3.

## 10. Amazon Business Ordering API (a *supplier*, not the storefront above)

**TODO(HUMAN)**: Register for [Amazon Business](https://business.amazon.com/) API access (separate
program from SP-API above — this is for *buying* from Amazon Business as a dropshipping supplier, not
selling on Amazon). Obtain an API key and set:
```
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put AMAZON_BUSINESS_API_KEY --config ../../wrangler.toml
```
Then insert/update a `suppliers` row with `provider = 'amazon_business'`, `kind = 'api'`, and
`api_key_ref = 'env:AMAZON_BUSINESS_API_KEY'`.

## 11. AliExpress Open Platform

**TODO(HUMAN)**: Register an app at the [AliExpress Open Platform](https://openservice.aliexpress.com/)
console (App Category "Drop Shipping") to get `ALIEXPRESS_APP_KEY` / `ALIEXPRESS_APP_SECRET` — this
step is fully self-serve, and the "AliExpress-dropship" API permission group is granted automatically
alongside "System Tool" when the app is created (no separate approval step observed in practice).

**Check your app's "Auth Management" page for its actual Access/Refresh Token Duration.** Confirmed
against a real account: **1-day access tokens, 2-day refresh tokens, and the refresh token's expiry is
fixed at initial authorization — it is NOT extended by using it to refresh.** Two live refresh calls in
a row returned an identical `refresh_token_valid_time`. This means **full re-authorization (step 2
below) is unavoidable roughly every 2 days**, no matter how often the automatic refresh runs — there is
no way to keep this integration connected purely automatically long-term. Budget for redoing step 2
periodically (or build a reminder for yourself) until/unless a future version adds a
notification when the refresh token is close to its hard expiry.

**Known limitation: product search (`searchProduct`, used by the SKU/listing match cascade) doesn't
return relevant results.** Confirmed live — `aliexpress.ds.text.search`'s `selection_search_product`
looks like AliExpress's curated "Dropshipping Selection" feed, not a real full-catalog keyword search;
the same query returns a different, mostly irrelevant set of products on repeated calls. A minimum
relevance cutoff (`MIN_CANDIDATE_SCORE_FOR_REVIEW` in `matchListing.ts`) stops obviously-wrong
candidates from reaching the manual-match picker, but doesn't fix the underlying search quality — for
this specific supplier, expect the auto-cascade to rarely find a confident match, and the manual picker
to sometimes come up empty even when a good product genuinely exists on AliExpress. **TODO(HUMAN)**: the
real fix is AliExpress's Affiliate API (`aliexpress.affiliate.product.query`, genuine keyword search),
but it requires a *separate* signup at the [AliExpress Affiliate Portal](https://portals.aliexpress.com/)
(distinct from the Open Platform app above, ~1-3 business day approval) to obtain a `tracking_id`
required on every call — not something this app's current AliExpress app approval covers, and not
something a code change alone can unlock. See DECISIONS.md for the full investigation.

1. Register the app, get `ALIEXPRESS_APP_KEY` / `ALIEXPRESS_APP_SECRET`.
2. Run AliExpress's OAuth authorization flow once (as the specific AliExpress account that will
   actually fulfill dropshipping orders) to obtain an initial `ALIEXPRESS_OAUTH_ACCESS_TOKEN` /
   `ALIEXPRESS_OAUTH_REFRESH_TOKEN` pair:
   ```
   https://api-sg.aliexpress.com/oauth/authorize?response_type=code&client_id=<APP_KEY>&redirect_uri=<CALLBACK_URL>&sp=ae&view=web
   ```
   The callback URL needs to land on a real response for the authorization `code` to be visible — this
   Worker has a purpose-built landing page at `/oauth/aliexpress/callback` (see
   `apps/worker/src/routes/oauth.ts`) that just displays the code for you to copy; register that as your
   app's Callback URL. Then exchange the code for tokens — **confirmed working** against a live account:
   ```
   GET https://api-sg.aliexpress.com/rest/auth/token/create?app_key=...&timestamp=...&sign_method=sha256&code=...&sign=...
   ```
   Note this is a **separate REST endpoint family** from the `/sync` gateway used for `aliexpress.ds.*`
   business calls, and its signature is computed differently: HMAC-SHA256 over `/auth/token/create` (the
   path) prepended to the sorted-concatenated params — see `sign.ts`'s docstring for why. Token refresh
   uses the identical pattern at `/rest/auth/token/refresh`, which `RealAliExpressClient` performs
   automatically.
3. Set secrets (these only seed the *first* request — `RealAliExpressClient` persists every subsequent
   refreshed token onto the `suppliers` row itself, not back into these static secrets):
   ```
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put ALIEXPRESS_APP_KEY --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put ALIEXPRESS_APP_SECRET --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put ALIEXPRESS_OAUTH_ACCESS_TOKEN --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put ALIEXPRESS_OAUTH_REFRESH_TOKEN --config ../../wrangler.toml
   ```
4. Insert a `suppliers` row with `provider = 'aliexpress'`, `kind = 'api'`, and
   `oauth_access_token_ref = 'env:ALIEXPRESS_OAUTH_ACCESS_TOKEN'` /
   `oauth_refresh_token_ref = 'env:ALIEXPRESS_OAUTH_REFRESH_TOKEN'` — the same `env:`-pointer convention
   every other OAuth-backed row in this schema uses (see DECISIONS.md).

Every request is signed with `packages/adapters/src/supplierApi/aliexpress/sign.ts` (HMAC-SHA256 over
sorted, concatenated params) using `ALIEXPRESS_APP_SECRET` — no further manual signing setup needed.

## 12. CJ Dropshipping

**TODO(HUMAN)**: Create a [CJ Dropshipping](https://cjdropshipping.com/) account. **Do not use the
email+password login endpoint** — confirmed live, it rejects credentials for accounts using "apiKey
mode" (which appears to be the default now) and its own error message points at the alternative below.
1. In your CJ account dashboard, find the **API** / developer settings section and generate an API key
   — it looks like `CJUserNum@api@xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.
2. Exchange it for a real access token, **once, out-of-band** (confirmed working live):
   ```
   curl -s -X POST https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken \
     -H "Content-Type: application/json" \
     -d '{"apiKey": "CJUserNum@api@..."}'
   ```
   The response's `data.accessToken` is what `CJ_API_KEY` should be set to (not the raw `apiKey` from
   step 1) — a live account's token was valid for **~6 months**, comfortably long enough that manual
   renewal (repeating this step, updating the secret) is practical. CJ does document a real
   `/authentication/refreshAccessToken` endpoint if automatic renewal is ever worth adding — this
   adapter doesn't use it yet, unlike the full auto-refresh eBay/Amazon/Gmail/AliExpress have.
3. Set the secret:
   ```
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put CJ_API_KEY --config ../../wrangler.toml
   ```
4. Insert/update a `suppliers` row with `provider = 'cj'`, `kind = 'api'`.

## 13. Gmail API (supplier shipping-confirmation email polling)

**TODO(HUMAN)**: In the [Google Cloud Console](https://console.cloud.google.com/), create a project
(or reuse the one from your Gemini key), enable the **Gmail API**, and create an OAuth 2.0 Client ID
(type: Web application or Desktop, your choice — a Desktop client is simplest for a one-time manual
consent flow). Then:
1. Run Google's OAuth consent flow once, by hand, requesting the
   `https://www.googleapis.com/auth/gmail.readonly` scope, to get an initial `GMAIL_OAUTH_REFRESH_TOKEN`.
2. Set secrets:
   ```
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put GMAIL_CLIENT_ID --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put GMAIL_CLIENT_SECRET --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put GMAIL_OAUTH_REFRESH_TOKEN --config ../../wrangler.toml
   ```
3. Update the relevant `users` row's `gmail_refresh_token_ref` (etc.) to point at these secrets — the
   `*/5 * * * *` cron trigger (`apps/worker/src/scheduled.ts`) polls automatically from then on; no
   further manual step is needed. Read-only scope is deliberate — this integration never sends,
   modifies, or deletes anything in your inbox.

## 14. Tracking Conversion Middleware — cascades TrackTaco → TrackCaptain; Bluecare Express / Aquiline are dead

**Resolved (2026-07), fully automated.** **Bluecare Express and Aquiline no longer work** — eBay
removed both from its accepted carrier list (Bluecare: announced mid-2024, enforced through
2025–2026; Aquiline: the same crackdown) — uploading either one's output now gets policy defects
(MC011) on every affected order, not protection from them.
`packages/adapters/src/trackingProxy/{bluecareExpress,aquiline}/real.ts` are kept only as reference
implementations / mock-parity fixtures; **do not set `BLUECARE_EXPRESS_API_KEY` or `AQUILINE_API_KEY`
expecting them to work in production.**

**Two live providers, both with real documented APIs**, confirmed 2026-07. Rather than picking one,
`apps/worker/src/trackingUploader.ts`'s `attemptAutomatedProxyConversion` **cascades through every
configured provider** (TrackTaco first, then TrackCaptain) and uses whichever succeeds first — a
provider with no key configured is skipped silently; a configured provider that fails (no credits, no
match, network error) logs and falls through to the next one:
- **TrackTaco** (`https://v2.tracktaco.com`) — two-step: `POST /v2/tns/search` (free, rich filters —
  carrier/destination/status/date-range) returns candidate `tn_id`s, then `POST /v2/tns/reveal`
  (1 credit) claims the actual number. `real.ts` fetches a small batch of candidates and automatically
  moves to the next one if the first comes back `already_revealed` (their docs name this as an
  expected race, not an error). Tried first — a live hands-on comparison found TrackCaptain's own web
  dashboard search returned zero results for a plausible destination+date filter combination, while
  TrackTaco's search worked cleanly.
- **TrackCaptain** (`https://trackcaptain.com/api/v1`) — one-shot `POST /tracking/match-and-claim`,
  also 1 credit. Tried second in the cascade.

Set `TRACKING_PROXY_PROVIDER` to pin a single provider instead of cascading (`trackcaptain`,
`bluecare_express`, or `aquiline` — the latter two only reachable this way, never part of the
automatic cascade, since they're known dead).

Both live providers match by the buyer's ship-to destination (city/state/zip/country — persisted on
`orders.ship_to_json` at marketplace-order-ingestion time, see `marketplaceSync.ts`) rather than
converting a specific original tracking number, and both satisfy the broadened tracking-proxy hard
rule (spec section 7 — see `packages/core/src/trackingProxy.ts` — now covers every
unrecognized-carrier supplier, not just Amazon Logistics: AliExpress/Temu's own carriers detect as
`carrierFinal: null` and need proxying exactly the same way `TBA...` numbers do).

**TODO(HUMAN)**:
1. Set API keys for whichever provider(s) you want in the cascade (both is fine — that's the point):
   ```
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put TRACKTACO_API_KEY --config ../../wrangler.toml
   pnpm --filter @fulfillment-tracker/worker exec wrangler secret put TRACKCAPTAIN_API_KEY --config ../../wrangler.toml
   ```
2. **Buy credits** — `GET /account` (both providers have one) reports your balance; a fresh account
   starts at 0, and every successful claim/reveal costs 1 credit. With 0 credits everywhere, every
   automated attempt fails and falls through to the manual-claim safety net below — nothing breaks, it
   just doesn't proxy anything until funded.

**Fallback (manual claim)**: if the automated call fails for *any* reason — no credits, no match found
for that destination, key not yet configured, network error — the fulfillment is recorded pending
(never pushed to eBay un-proxied) and surfaces at `GET /api/extension/pending-tracking-proxy-conversions`.
The Chrome extension (`apps/extension/src/content/trackCaptain.ts`) injects a panel on
trackcaptain.com's own dashboard listing what still needs a number, for manually claiming and pasting
one in as a backstop — `POST /api/extension/pending-tracking-proxy-conversions/:id/complete`. From
there it's the same non-API-mode path as section 8 above if the storefront needs it. (This panel is
TrackCaptain-specific for now; if you standardize on TrackTaco, the same manual fallback pattern would
need its own content script for tracktaco.com's dashboard — not yet built, since the automated path is
the primary one either way.)

Local dev/test (`MOCK_MODE=true`) is unaffected: `pushTrackingWithProxy` still uses the existing
synchronous mock proxy clients there, so nothing in this flow needs real credentials to develop
against — see `apps/worker/src/trackingUploader.ts`.

## 14b. Product discovery ("Opportunities" page)

Two data sources, two different credential sets:

- **Active-listing search** (`searchActiveListings`) uses the same `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`
  already set up in section 8 — no new secrets. App-level (client-credentials) token, not any per-user
  storefront token, since it searches eBay's public catalog generally. Optional override:
  `EBAY_MARKETPLACE_ID` (defaults to `EBAY_US`).
- **Confirmed-sold search** (`searchSoldListings`, the one that actually drives the opportunity score
  and the deep-search loop) uses **Apify**, since eBay's own sold-data API (Marketplace Insights) is
  gated behind a discretionary business-unit approval this app doesn't have (see DECISIONS.md — small
  apps are routinely denied even after requesting the scope). **TODO(HUMAN)**: sign up at
  [apify.com](https://apify.com/) (free tier gives ~$5 credit, roughly 1,400 sold-listing records — test
  before deciding on any paid usage) and grab an API token from Settings → Integrations:
  ```
  pnpm --filter @fulfillment-tracker/worker exec wrangler secret put APIFY_TOKEN --config ../../wrangler.toml
  ```
  Optional override: `APIFY_EBAY_SOLD_ACTOR_ID` (defaults to `caffein.dev~ebay-sold-listings`) if you
  find a better/cheaper equivalent actor later.

**Mock mode requires all three eBay-related secrets to look real** (`EBAY_CLIENT_ID`,
`EBAY_CLIENT_SECRET`, `APIFY_TOKEN`) — any one missing/placeholder and the whole client falls back to
mock, since the two search methods depend on different credentials entirely.

**Confirmed live, not every actor works — check before swapping.** Two other seemingly-reasonable
candidate actors (`automation-lab/ebay-sold-scraper`, `midwest_united/ebay-sold-comps`) both returned
zero results even for extremely high-volume terms ("nintendo switch console"), one with an explicit
Akamai bot-challenge in its log — they're either currently blocked or have stale selectors. If you ever
swap `APIFY_EBAY_SOLD_ACTOR_ID`, test it directly against Apify's API first (a popular, recently-built,
high-run-count actor is a much better signal of live functionality than its description) before trusting
it in this app — see DECISIONS.md for exactly how this was diagnosed.

**Known data-quality gap**: the wired-up actor's `sellerUsername` field comes back `null` on every
result observed — it doesn't reliably expose seller identity, so the `uniqueSellers` competition signal
in the opportunity score likely undercounts. Price and sales-velocity signals are solid; treat the
competition dimension with more skepticism until/unless a better actor surfaces this properly.

## 15. The Edge Agent (Chrome extension)

**TODO(HUMAN)**: This is a local/manual Chrome install, not a Cloudflare deployment step — Manifest V3
extensions built for a single organization's internal tooling (rather than public distribution) don't
need a Chrome Web Store listing.
1. `pnpm build:extension` (from the repo root) — produces `apps/extension/dist/`.
2. In Chrome, go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and
   select `apps/extension/dist/`.
3. Open the extension's popup and sign in the same way the dashboard does (in `MOCK_MODE`, the literal
   `dev-user` bearer token; once Clerk is live, whatever token `apps/extension/src/popup/App.tsx`'s
   auth flow obtains).
4. Set the extension's backend URL (`apps/extension/src/lib/config.ts`) to your deployed Worker's URL
   before building for anything other than local dev against `wrangler dev`.
5. **TODO(HUMAN)**: `apps/extension/src/lib/addressMapping.ts`'s `DEFAULT_AMAZON_CHECKOUT_SELECTORS`
   (the DOM selectors used to auto-paste a buyer's shipping address into Amazon's real checkout page)
   are a best-effort guess written without a live checkout session to verify against — inspect Amazon's
   actual checkout DOM once you're pasting into a real account and adjust the selectors if they've
   drifted. Same caveat for `apps/extension/src/content/ebayTracking.ts`'s eBay "Add tracking" page
   selectors.
6. For a team beyond one person, publish to the Chrome Web Store as an **unlisted** (not public) item
   instead of step 2's "Load unpacked" — out of scope to script here since it requires a Google
   Developer account and a one-time $5 registration fee that only a human can pay.

## 16. Deploy

Once the steps above are done and secrets are set:
```
pnpm db:migrate:prod && pnpm build && wrangler deploy --config wrangler.toml
```
(`pnpm build` must run first so `apps/dashboard/dist` exists for the `[assets]` binding — `wrangler
deploy` alone will fail with "assets directory does not exist" otherwise, exactly like the dry-run
validation this repo already runs in CI.) Run `pnpm build:extension` separately (step 15) — the
extension is a distinct deployable, not bundled into the Worker's assets.

## Known limitation: Workflows require Cloudflare connectivity even in local dev

`wrangler dev` in this project (wrangler 3.114, Workflows "open beta") lists the `ORDER_WORKFLOW` /
`DISPUTE_WORKFLOW` bindings as `[connected to remote resource]` rather than `[simulated locally]` —
unlike D1 and Queues, Workflows execution isn't fully offline-simulatable in this wrangler version,
even after `wrangler login`. This was discovered by smoke-testing the local dev server: a real
Shopify webhook was accepted, persisted to D1, and enqueued correctly, but the order's `evaluate-margin`
step never ran without live Cloudflare connectivity, so the order stayed in `received` instead of
progressing to `evaluating`/`rejected`.

Everything **except** actually executing the durable Workflow was verified end-to-end locally
(webhook → D1 write → queue send). Workflow *step logic* itself is fully covered by
`apps/worker/src/workflows/*.test.ts`, which call `runOrderWorkflow` / `runDisputeWorkflow` directly
against a real D1 test database with a mocked `step` context — per spec section 11's own testing
requirement, this is the sanctioned way to test Workflows, not full binding-driven execution. See
DECISIONS.md milestones 5 and 6 for the full reasoning. To see a Workflow actually run end-to-end,
either deploy to a real Cloudflare account (still $0 on the free tier) or run `wrangler dev` after
`wrangler login` with an authenticated session — this project does not attempt (and was explicitly
told not to attempt) a real `wrangler deploy` during the autonomous build itself.
