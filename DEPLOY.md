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

## 8. Deploy

Once the steps above are done and secrets are set:
```
pnpm db:migrate:prod && pnpm build && wrangler deploy --config wrangler.toml
```
(`pnpm build` must run first so `apps/dashboard/dist` exists for the `[assets]` binding — `wrangler
deploy` alone will fail with "assets directory does not exist" otherwise, exactly like the dry-run
validation this repo already runs in CI.)

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
