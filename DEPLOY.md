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

## 5. Google Gemini API key

**TODO(HUMAN)**: Create an API key at [Google AI Studio](https://aistudio.google.com/apikey) (or via
Google Cloud Console → Vertex AI, if using the Vertex-backed endpoint instead of the public
`generativelanguage.googleapis.com` one already wired in `packages/adapters/src/gemini/real.ts`).
```
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put GEMINI_API_KEY --config ../../wrangler.toml
```
Gemini is called from exactly two places (hard architectural rule) — email-extraction fallback and
dispute-email drafting — never in the margin/pricing path.

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
(`apps/dashboard/src/lib/clerkAuth.tsx`). You'll also need to create a `users` row whose
`clerk_user_id` matches the real Clerk user id (the mock's `dev-user` convention doesn't apply once
Clerk is live) — either via `wrangler d1 execute ... --remote` or a small onboarding endpoint you add.

---

# Phase 2 — Multi-Marketplace Dropshipping Automation

Everything below is additive to Phase 1's setup above. All of it stays mock-backed
(`MOCK_MODE=true`, or per-adapter `PLACEHOLDER__` key detection) until you actually work through
these steps — none of it is required for `pnpm dev` / `pnpm test`.

## 8. eBay (Sell APIs: Fulfillment, Inventory, Post-Order) + non-API fallback

**⚠️ BLOCKER — read before inserting a real eBay `storefronts` row**: on the real production database
(as of the Gmail-integration deployment), `storefronts.platform`'s CHECK constraint still only allows
`'shopify'` — it was **not** widened to include `'ebay'`/`'amazon'` when the rest of Phase 2's schema was
retrofitted onto the live, already-populated database, because doing so safely requires a coordinated
rebuild of `storefronts` and every table transitively chained to it via foreign keys (`orders` →
`order_line_items`/`fulfillments` → `fulfillment_line_items`/`disputes`), all of which have real data.
See DECISIONS.md's "Phase 2 remote migration retrofit" entry for the full reasoning. **Attempting to
insert an eBay storefront row today will fail with a CHECK constraint violation.** Before step 4 below,
this needs to be resolved — either by carefully performing that cascading rebuild (plan it out, verify
with `PRAGMA foreign_key_check` afterward) or by deciding to drop the DB-level CHECK on `platform`
entirely and rely on TypeScript's compile-time enum enforcement alone. Flag this to whoever's doing the
setup so it isn't rediscovered mid-flow.

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

## 9. Amazon SP-API (orders, RDT-gated address access, feeds, listings)

**⚠️ Same blocker as eBay's section 8 applies here** — a real `storefronts` row with `platform='amazon'`
will also be rejected by the production database's CHECK constraint until that's resolved. See section
8's warning and DECISIONS.md's "Phase 2 remote migration retrofit" entry.

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

**Check your app's "Auth Management" page for its actual Access/Refresh Token Duration** — one real
account observed **1-day access tokens / 2-day refresh tokens**, which is why this adapter
auto-refreshes (`RealAliExpressClient.ensureFreshSession()`) rather than treating the token as a
long-lived static secret the way CJ's is treated. As long as something touches this supplier at least
once every couple of days (the repricing sweep alone does, hourly), the refresh token should keep
rolling forward indefinitely — **TODO(HUMAN)**: confirm AliExpress actually rotates the refresh token
on each use (extending its 2-day window) rather than keeping a fixed expiry from initial authorization;
if it's the latter, full re-authorization (steps 2 below) will be needed roughly every 2 days.

1. Register the app, get `ALIEXPRESS_APP_KEY` / `ALIEXPRESS_APP_SECRET`.
2. Run AliExpress's OAuth authorization flow once (as the specific AliExpress account that will
   actually fulfill dropshipping orders) to obtain an initial `ALIEXPRESS_OAUTH_ACCESS_TOKEN` /
   `ALIEXPRESS_OAUTH_REFRESH_TOKEN` pair — the callback URL is whatever you set on the app (doesn't need
   to be a real working endpoint; the authorization `code` appears in the browser's address bar after
   redirect even if nothing responds there). Exchange the code for tokens via the same signed gateway
   (`method=auth/token/create`) or your console's own token-generation tool if it has one.
   **TODO(HUMAN)**: the exact exchange/refresh endpoint shapes (`auth/token/create`,
   `auth/token/refresh`) are unverified against a live account — confirm against AliExpress's actual
   docs once you're here; `RealAliExpressClient`'s refresh implementation is flagged the same way.
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

**TODO(HUMAN)**: Create a [CJ Dropshipping](https://cjdropshipping.com/) account, then obtain a
`CJ-Access-Token` via CJ's own email+password login endpoint **once, out-of-band** (their token is
long-lived, ~15 days per their docs — deliberately not fetched automatically by this app on every
request; see DECISIONS.md milestone 4 for why keeping your account password out of the Worker's
request path entirely is safer). Set:
```
pnpm --filter @fulfillment-tracker/worker exec wrangler secret put CJ_API_KEY --config ../../wrangler.toml
```
You'll need to repeat the manual login step and rotate this secret roughly every two weeks (or before
it expires) until/unless you automate the rotation yourself. Insert/update a `suppliers` row with
`provider = 'cj'`, `kind = 'api'`.

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

## 14. Tracking Conversion Middleware (Bluecare Express / Aquiline)

**TODO(HUMAN)**: This step is **mandatory before going live with any Amazon → eBay dropshipping
route** — the hard architectural rule requires Amazon Logistics (`TBA...`) tracking numbers destined
for an eBay buyer to be proxied through one of these two providers, never pushed to eBay raw (eBay's
policies prohibit exposing Amazon as the shipper). Pick one:
- [Bluecare Express](https://www.bluecareexpress.com/) (default provider) — register an account, get
  an API key, set:
  ```
  pnpm --filter @fulfillment-tracker/worker exec wrangler secret put BLUECARE_EXPRESS_API_KEY --config ../../wrangler.toml
  ```
- [Aquiline](https://aquiline.com/) (alternate provider) — register, get an API key, set:
  ```
  pnpm --filter @fulfillment-tracker/worker exec wrangler secret put AQUILINE_API_KEY --config ../../wrangler.toml
  pnpm --filter @fulfillment-tracker/worker exec wrangler secret put TRACKING_PROXY_PROVIDER --config ../../wrangler.toml
  ```
  (set the value of `TRACKING_PROXY_PROVIDER` to the literal string `aquiline`; omit it entirely to
  keep the Bluecare Express default).

Both real adapters (`packages/adapters/src/trackingProxy/{bluecareExpress,aquiline}/real.ts`) were
written against each provider's publicly documented API shape without a live account to verify
against — **TODO(HUMAN)**: confirm the exact request/response shape once you have a real account,
before relying on this path in production. Until then, `pushTrackingWithProxy` (the single required
call path — see DECISIONS.md milestone 7) still records every attempt in the `tracking_events` audit
table, so a shape mismatch fails loudly rather than silently.

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
