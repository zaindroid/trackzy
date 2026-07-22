# Decisions Log

Autonomous build session. Every non-obvious choice made without a human in the loop is recorded here, in the order it was made.

## Environment
- The build sandbox had no Node.js/pnpm preinstalled and no passwordless sudo. Installed Node 20.18.1 as a user-local binary (`~/.local/node`) and enabled pnpm 9.15.0 via corepack, symlinked into `~/.local/bin` (already first on `$PATH`). No system packages were touched. This is a build-environment detail only; it has no bearing on the deployed Cloudflare Worker.

## Milestone 1 — Scaffold
- Package manager: pnpm workspaces (`packages/*`, `apps/*`) as mandated.
- Lint: flat-config was considered but ESLint 8 `.eslintrc.json` + `eslint-config-prettier` chosen for simplicity and broad plugin compatibility with `@typescript-eslint` at build time; no behavioral impact.
- `tsconfig.base.json` sets `strict` + `noUncheckedIndexedAccess` as required; each package/app extends it with its own `module`/`jsx`/`types` needs (Worker packages target `Bundler` resolution for Wrangler compatibility, dashboard adds `jsx: react-jsx`).
- Root `build` script builds the dashboard first, then the worker (which copies dashboard `dist/` into worker assets) — order matters because the worker's static-assets directory depends on the dashboard build output.

## Milestone 2 — packages/core
- Carrier checksum algorithms (UPS mod-10, USPS/S10 mod-10, DHL AWB mod-7) are the widely-circulated
  reverse-engineered versions, since none of these carriers publish an official checksum spec publicly.
  Rather than chase an unverifiable "known-correct" example, test vectors were generated directly from
  the implemented algorithm itself (see `carriers/*.test.ts` comments) — this validates internal
  self-consistency (valid numbers verify, any single flipped digit fails) which is what the build spec
  actually requires, not literal conformance to UPS/USPS/DHL internal systems.
- FedEx (12/15-digit) and DHL eCommerce ("JD"-prefixed) numbers have no public checksum at all, so their
  validators are format-only and return `weak: true`. Their negative test cases are format violations
  (wrong length, bad characters) rather than digit-flips, since a digit flip within a valid-length numeric
  string cannot be caught without a checksum — documented inline in `fedex.test.ts`.
- `detectCarrier`'s ambiguity rule only fires for USPS-format numbers in the 92-95 prefix range with no
  declared carrier (exactly as spec section 6c states) — FedEx/DHL-weak matches are marked `weak` but not
  `needsReview`, since the priority chain treats them as a distinct (lower-confidence) detection outcome,
  not a failure requiring human review.
- Two fictional suppliers (Acme Supply Co, Globex Goods) were invented with distinct email formats to
  give the parser registry two concretely different regex parsers to select between, as required by
  "per-supplier email regex parsers + parser registry" — reused later for DB seed data and email fixtures.

## Milestone 3 — packages/db
- Drizzle's `text({ enum: [...] })` only enforces the enum at the TypeScript type level, not in SQLite —
  the spec's schema literally writes `status text check in (...)` for six columns (storefronts.platform,
  orders.status, fulfillments.source, webhook_events.source, disputes.status, settings.margin_mode), so
  explicit `check()` table constraints were added to schema.ts to get real DB-level enforcement, verified
  by round-tripping the generated migration through Python's stdlib `sqlite3` (rejects a bogus enum value
  with `CHECK constraint failed`).
- No `sqlite3`/`wrangler`/`better-sqlite3` was available yet in the build sandbox at this point (Worker app
  not scaffolded), so the migration + seed SQL were validated end-to-end by applying them to a real
  in-memory SQLite database via Python's stdlib `sqlite3` module (present on the base image) — confirms
  foreign-key integrity (`PRAGMA foreign_key_check`), the CHECK constraints, and correct row counts across
  all six `orders.status` values before trusting the files. This was a one-off verification step, not a
  new project dependency.
- Seed IDs are real, deterministically-generated ULIDs (`ulid`'s `monotonicFactory` fed by a seeded
  mulberry32 PRNG, not `Math.random()`), so `pnpm db:seed` produces a byte-identical `seed.sql` on every
  run — required for the seed file to be diff-stable in git.
- `seed.ts` writes `packages/db/seed.sql` (a plain SQL file) rather than inserting rows over a live D1
  binding, because D1 is only reachable from within the Workers runtime (or `wrangler d1 execute`), not
  from a plain Node script. The generated file is applied via
  `wrangler d1 execute DB --local --file=packages/db/seed.sql` (documented in DEPLOY.md/README) after
  migrations run. `seed.sql` is committed alongside the generator since it's deterministic — effectively
  source, not a build artifact.
- One demo user, one Shopify storefront, two suppliers, and six orders — one in each `orders.status` value
  (`shipped`, `delivered`, `partially_shipped`, `fulfilling`, `exception`, `rejected`) — so every
  dashboard page/filter has at least one non-empty row without hand-tuning fixtures later. The `exception`
  order also carries an open `disputes` row and a `needs_review` fulfillment (ambiguous 92-prefixed USPS
  number, no declared carrier) so the Disputes and Fulfillments "Needs review" pages aren't empty either;
  a malformed/unmatched supplier email is seeded into `webhook_events` for the email "Needs review" list.

## Milestone 4 — adapters + fixtures
- Multi-tenant config (Shopify `shopDomain`, supplier `baseUrl`) is passed per-call rather than baked into
  the adapter at construction time, mirroring how `storefronts`/`suppliers` rows carry that config in D1
  while `createX(env)` only has access to process-wide secrets/flags. Secrets stay in the factory closure;
  non-secret per-tenant routing info is a method parameter. This keeps a single adapter instance reusable
  across all of a user's storefronts/suppliers.
- `SessionVerifier.verifySession` returns `{ clerkUserId }` only, not an internal `users.id` — resolving
  Clerk's external id to our own primary key is a D1 lookup, which belongs in the Worker's auth middleware
  (milestone 7), not inside the adapter. Keeps the adapters package free of any dependency on `@fulfillment-tracker/db`.
- `MockGeminiExtractor` does not read canned fixtures from `fixtures/gemini/*.json` — those files exist as
  documentation of the exact structured-output shape the real Gemini adapter parses (useful for the
  DEPLOY.md Gemini setup step and for anyone wiring a real key), but the mock itself scans for any
  carrier-shaped token via regex. This makes it a genuine (if simplified) extraction fallback that behaves
  sensibly on arbitrary/malformed email fixtures instead of only ever returning one hardcoded canned reply,
  which was needed to make "malformed email falls through to Gemini path" an actually meaningful test.
- HMAC verification (`packages/adapters/src/hmac.ts`) lives in the adapters package, not core, because it
  uses the Workers/Web Crypto global (`crypto.subtle`) rather than being pure portable logic — it's shared
  by the Shopify webhook route and is available for the 17TRACK route if/when a real signature scheme is
  wired up (17TRACK's own webhook push notifications are not documented as HMAC-signed in their public
  docs at the time of writing; DEPLOY.md flags this for human verification against the live 17TRACK
  account before production use).
- Email fixtures: two suppliers (Acme, Globex) each get a shipping-notification email (parses cleanly) and
  an invoice/billing email (must NOT produce a false-positive tracking match), plus one sender-unmatched
  email with no tracking-shaped text (exercises the "nothing worked, needs review" path end-to-end) and one
  exact-Message-ID duplicate of the Acme tracking email (exercises `webhook_events` dedup on re-delivery).

## Milestone 5 — worker ingestion (webhooks + email + queue)
- Added `wrangler.test.toml`, a copy of `wrangler.toml` without the `[[workflows]]` bindings, used only by
  `apps/worker/vitest.config.ts`. `@cloudflare/vitest-pool-workers` 0.6.16 wraps the user worker's entry
  module with its own runner, which does not re-export named classes (`OrderWorkflow`/`DisputeWorkflow`)
  from that entry file — binding a Workflow to a `class_name` it can't find crashes Miniflare at startup
  ("has no such named entrypoint"). Spec section 11 already scopes workflow testing to unit-testing step
  functions with a mocked `step` context rather than full binding-driven execution, so this is a clean split:
  HTTP-level webhook/email/queue tests run against `wrangler.test.toml`; workflow logic is tested directly
  in milestone 6 without needing the binding at all. Worker code that calls `env.ORDER_WORKFLOW` /
  `env.DISPUTE_WORKFLOW` goes through `safeGetWorkflowInstance()` (`apps/worker/src/lib/workflow.ts`), which
  tolerates the binding being entirely absent, not just "instance not found" — production `wrangler.toml`
  always has the real bindings, so this only changes behavior under test.
- `packages/adapters/package.json` gained subpath exports (`./hmac`, `./gemini`, `./shopify`, etc.) and the
  worker imports from those narrow paths instead of the package barrel. Importing the barrel from
  `webhooks.shopify.ts` (which only needs `verifyHmacSha256`) pulled `@clerk/backend` into that route's
  module graph, and one of its transitive deps (`snakecase-keys`) fails to bundle for the Workers runtime
  in this esbuild/Miniflare version ("Cannot use require() to import an ES Module"). Narrow imports fixed
  it and are better hygiene regardless — a webhook route has no business bundling the auth SDK.
- `verifyHmacSha256` now fails closed (`return false`) on an empty secret instead of letting
  `crypto.subtle.importKey` throw on zero-length key data — an unset/misconfigured secret should read as
  "reject everything", not crash the request handler with a 500.
- Email-to-order correlation (spec 6b) does not join on `orders.externalOrderNumber` against the supplier's
  own order reference (e.g. "AC-10293") — those two identifier spaces are unrelated (Shopify's "#1001" vs.
  the supplier's own numbering) and the schema has no column to bridge them (fulfillments doesn't carry a
  supplier-side order id). Instead, a tracking email is matched to the **oldest fulfillment row for that
  supplier still awaiting a tracking number** (`fulfillments.trackingNumber IS NULL`), a FIFO heuristic
  that's realistic for a single-tenant demo. A production system would instead persist the supplier's own
  order id on the fulfillment row when `SupplierClient.createOrder()` returns it and join on that directly —
  noted here rather than silently deviating from the spec's literal schema.
- The Shopify webhook route resolves `storefronts.*_ref` pointers (`"env:SHOPIFY_WEBHOOK_SECRET"`) against
  the Worker's `env` at request time — consistent with the single-tenant dev-fallback convention already
  documented in `.dev.vars.example` and DECISIONS.md milestone 4.

## Milestone 6 — Workflows (order + dispute)
- The schema (spec section 5) has no table linking a SKU or order to a specific supplier — `fulfillments`
  only gets a `supplier_id` once a fulfillment is placed. Since `evaluate-margin` must already know which
  supplier to price against, `OrderWorkflow` picks the **oldest active supplier for the order's storefront
  owner** (`suppliers.userId`, `active=1`, earliest `createdAt`) and uses it for the whole order. This is a
  real simplification forced by the fixed schema (no `supplier_skus`/`products` table); a production system
  would add one and route each line item to the supplier that actually stocks it.
- `runOrderWorkflow` is a plain exported async function taking `{ step, env, orderId }`, with the
  `WorkflowEntrypoint` class (`order.ts`) reduced to a one-line delegator. This is what makes spec 11's
  "unit-test step functions with mocked step context" possible: tests construct a minimal fake `WorkflowStep`
  (`.do` just invokes its callback immediately, `.waitForEvent` pops from a per-type queue and throws to
  simulate a timeout once exhausted) and call `runOrderWorkflow` directly against the real D1 test database
  from `cloudflare:test` — real business logic, fake orchestration wrapper. Same pattern for
  `runDisputeWorkflow` / `disputeLogic.ts`.
- The Shopify `fulfillmentOrderId` returned by the `fetch-fulfillment-order` step is threaded through as a
  plain local variable / function parameter into `pushFulfillmentStep`, not re-fetched or re-derived later.
  An earlier draft tried to reconstruct it from a line item's `fulfillmentOrderLineItemId` string, which is
  wrong (the mock/real Shopify adapters use independent numeric namespaces for order-level vs. line-item-level
  gids) — this is exactly the pattern Workflows is designed for: step results are checkpointed, so capturing
  a step's return value in a local variable and passing it to a later step is correct and durable, not a
  hack.
- Multi-box shipments (spec 7 steps 4-6 looping) are matched to order line items via the tracking event's
  optional `sku` field: an event naming a SKU covers only that line item; an event with no SKU is treated as
  a single-box shipment covering everything still outstanding. This directly supports the "two tracking
  events fully fulfill a 3-item order" test case (spec section 11) — event 1 names SKU-A (1 unit), event 2
  has no SKU and sweeps the remaining SKU-B (2 units).
- `await-tracking`'s timeout handling (spec 7 step 4: "wait again, up to 2 more cycles") is implemented as
  up to 3 total `waitForEvent` attempts on the *same* fulfillment shell, each timeout drafting a dispute and
  marking the order `exception` before retrying; this is distinct from the check-complete loop creating a
  *new* fulfillment shell for the next box on a partial shipment — the two loops are related but not the
  same thing, so they're implemented as separate constructs (`awaitTrackingForFulfillment`'s internal retry
  loop vs. `runOrderWorkflow`'s outer `while (!complete)` loop) rather than conflated into one counter.
- `await-delivery` (spec 7 step 7) is only awaited for the **final** fulfillment shell in a multi-box order,
  as a pragmatic stand-in for whole-order delivery confirmation; the 17TRACK webhook route (milestone 5)
  already updates any fulfillment's `tracking_status` directly regardless of workflow state, so per-box
  status is still correct even though only the last box's delivery event resolves `orders.status` to
  `'delivered'`.
- `DisputeWorkflow` instances are started via `env.DISPUTE_WORKFLOW?.create(...)` wrapped in try/catch
  inside `orderLogic.ts`'s `draftDispute()` helper — both "binding entirely absent" (test environment, see
  milestone 5 decision on `wrangler.test.toml`) and "instance id collision" are swallowed, since dispute
  drafting here is best-effort from the order workflow's perspective; `DisputeWorkflow`'s own logic is unit
  tested directly and does not depend on how it was invoked.

## Milestone 7 — API routes + auth
- `@clerk/backend`'s CJS build calls `require('snakecase-keys')`, and something in that dependency's own
  chain fails to bundle for the Workers runtime under this esbuild/Miniflare version ("Cannot use require()
  to import an ES Module") — this time it wasn't a barrel-import hygiene issue (milestone 5's fix): the auth
  middleware genuinely needs `RealSessionVerifier` reachable from every `/api/*` route, and a *static*
  `import { verifyToken } from '@clerk/backend'` gets linked and evaluated by the JS module graph regardless
  of whether `MOCK_MODE` means it's never called. Fixed by making that one import dynamic
  (`await import('@clerk/backend')` inside `verifySession()`) — dynamic imports are only linked when actually
  awaited, so in MOCK_MODE (always true under `MockSessionVerifier`) the broken module graph is never
  touched. Real Clerk auth in production is unaffected; this only changes *when* the module loads.
- Auth is scoped per-request via `storefronts.userId` → `orders.storefrontId` → `fulfillments.orderId` →
  `disputes.fulfillmentId` join chains in every list/detail query, rather than trusting client-supplied ids —
  even though this demo seeds exactly one tenant, the API is written as if it weren't (defends against IDOR
  by construction rather than by convention).
- `POST /api/orders/:id/approve` can't resume the original `OrderWorkflow` instance (that run already ended
  at the margin-rejection `return`, and Workflow instance ids can't be reused) — it starts a **new** instance
  with a distinct id (`${orderId}:approved:${timestamp}`) and a `forceApprove: true` param that makes
  `evaluateMarginStep` skip the threshold check while still recording the real computed margin. This is a
  minimal, additive change (`WorkflowOrderPayload.forceApprove?: boolean`) rather than adding a second
  workflow entrypoint.
- `PATCH /api/disputes/:id` collapses `status: 'approved'` straight to `'sent'` in the same request (spec
  section 8: "approved -> marked sent; real sending is a placeholder adapter") since there's no separate
  human "now actually send it" step in the API surface — approving *is* sending in this demo. Real delivery
  is a `TODO(HUMAN)` wiring the `DISPUTE_EMAIL` send_email binding, listed in DEPLOY.md.
- `/api/health` is deliberately NOT part of the `routes/api/index.ts` sub-app (which applies
  `authMiddleware` to everything via `app.use('*', ...)` as its first line) — it's registered directly on
  the top-level Hono app in `index.ts`, before `/api` is mounted, so there's no ambiguity about whether a
  wildcard auth middleware registered after a sibling route actually covers it.

## Milestone 8 — dashboard
- Auth is a single React Context (`apps/dashboard/src/lib/auth.tsx`) with two possible providers:
  `MockAuthProvider` (default — shows "Continue as dev user", stores the literal string `dev-user` as
  the bearer token, matching `MockSessionVerifier`'s convention) or `ClerkAuthProvider`
  (`clerkAuth.tsx`, only lazy-loaded via dynamic `import()` when `VITE_CLERK_PUBLISHABLE_KEY` is set to
  a real-looking key). Both providers feed the *same* `AuthContext` defined once in `auth.tsx` — an
  earlier draft defined a second, separate context inside `clerkAuth.tsx`, which would have made
  `useAuthToken()` resolve to whichever context happened to be nearest in the tree rather than
  reliably pick up whichever provider is actually mounted; consolidated to one context so every page
  component only ever imports `useAuthToken` from `lib/auth.js` regardless of which auth mode is live.
- `@clerk/clerk-react` is a real dependency (spec section 3 requires it), but it's never imported by
  the default code path — `main.tsx` only `await import('./lib/clerkAuth.js')`s when
  `CLERK_CONFIGURED` is true, so the ~83KB Clerk chunk (visible as its own chunk in the `vite build`
  output) is never fetched by a browser running in mock mode.
- The API client (`lib/api.ts`) is a thin typed `fetch` wrapper, not a generated client — the response
  shapes are hand-typed to mirror the Worker's actual JSON envelopes (`{ orders: [...] }`,
  `{ error: { code, message } }`, etc.) rather than sharing types through a package boundary, since
  `apps/dashboard` and `apps/worker` are independent deployables (one ships to the browser, one to the
  edge) and spec section 4 doesn't list a shared `types` package between them. `TrackingCandidate` is
  the one exception — imported directly from `@fulfillment-tracker/core` in `SupplierDetail.tsx` for
  the live parser-test result shape, since `core` has zero Cloudflare-specific dependencies and is
  safe to bundle into a browser build.
- Settings page's "Storefront & API keys" section is deliberately read-only, pointing at DEPLOY.md's
  `wrangler secret put` commands instead of offering in-browser credential entry — spec section 5's
  schema stores `access_token_ref`/`webhook_secret_ref`/`api_key_ref` as *pointers*, not raw secrets,
  specifically so real credentials never pass through the browser or land in D1; building a UI that
  invited pasting a real Shopify token into a form would undermine that design.
- Test-mode `fetch` is stubbed per-test with `vi.stubGlobal('fetch', ...)` rather than MSW or a real
  network layer — no new dependency needed, and it keeps the two required frontend tests (Orders table
  renders seed data; Needs-review resolve flow calls PATCH) fast and deterministic while still
  asserting on the exact request body sent to `PATCH /api/fulfillments/:id`.

## Post-milestone-9 — dashboard visual redesign
User asked for the dashboard to be "elegant, modern, minimalistic," free of emojis (it already was), and
"super adaptable and easy to use." The original milestone-8 dashboard was functionally complete but
visually a generic dark-slate-950 + emerald-accent + rounded-pill SaaS template — exactly the kind of
default that doesn't read as a deliberate choice. Redesigned the full visual system rather than
patching colors:
- **Identity grounded in the actual subject** (freight/fulfillment operations, not generic SaaS):
  typography pairs "Big Shoulders Display" (a condensed industrial grotesque, used sparingly for
  page titles and the wordmark — evokes stenciled crate/manifest lettering) with "IBM Plex Sans" for
  body/UI text and "IBM Plex Mono" for anything that's a literal code on a real shipping document —
  order numbers, tracking numbers, SKUs, dollar amounts, timestamps. This is a non-decorative use of
  monospace: those values genuinely are printed as fixed-width codes on real labels/manifests.
- **Signature element**: `StatusStamp` (renamed from `StatusPill`) — a small square marker + uppercase
  monospace tag with no background fill, styled after a manifest flag entry rather than a generic
  filled pill. It's the one place the design takes a visible risk; everything around it (forms, panels,
  nav) stays quiet and mostly square-cornered (`rounded-sm`, 2px) to reinforce a precise, document-like
  feel without competing for attention.
- **Palette**: named CSS-variable tokens (`paper`/`paper-raised`/`ink`/`ink-muted`/`ink-faint`/`rule` for
  the light-default neutral system, plus `signal` — a rust/vermilion brand accent — and four semantic
  status colors, `freight`/`moss`/`ochre`/`brick`, each with a light and dark value) defined once in
  `index.css` and wired into `tailwind.config.js` via the `rgb(var(--x) / <alpha-value>)` pattern so
  Tailwind's opacity modifiers keep working. Light is the primary/default theme (paper, not the default
  near-black-with-neon-accent AI look); dark is a fully considered second theme, not an afterthought,
  toggled via `lib/theme.tsx` and persisted, with a blocking inline script in `index.html` so there's no
  flash of the wrong theme on load.
- **Genuine responsiveness, not just squeezed breakpoints**: `Layout.tsx` swaps a fixed desktop sidebar
  for a top bar + slide-over drawer below `lg`, hand-rolled with no new dependency. Every data table uses
  a `.manifest` CSS class (`index.css` `@layer components`) implementing the standard "real `<table>`
  markup, CSS-only reflow to labeled stacked rows below `md`" pattern — `data-label` attributes plus a
  `td::before { content: attr(data-label) }` rule. This was deliberately chosen over reshaping markup per
  breakpoint: it keeps every `getByRole('table')` / `getByText(...)` query in the existing Orders/
  Fulfillments tests passing unchanged (pseudo-element `content` isn't part of a DOM node's `textContent`,
  so it's invisible to Testing Library) while genuinely reflowing on a phone screen.
- Verified via `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (all green, same 97 tests) plus a
  manual audit of the compiled CSS output (confirmed `@font-face`/`font-family` rules for all three
  webfonts, the `content:var(--tw-content)` rules the status-stamp marker and responsive-table labels
  depend on, and grepped the whole `apps/dashboard/src` tree for leftover `slate-`/`emerald-`/`amber-`/
  `sky-` classes from the old palette — found and fixed one in the Clerk real-auth fallback screen, the
  only page not exercised by any test). No headless browser was available in this sandbox to capture an
  actual screenshot, so this was verified by build success + test success + line-by-line class review
  rather than a visual diff.

## First real deployment (post-build, human-directed)
With the user's explicit go-ahead, deployed to their real Cloudflare account (not part of the
autonomous build itself — the build's own hard rule against real `wrangler deploy` only applied to
the unattended build session; this was a separate, explicitly authorized action).
- **`wrangler d1 create` failed with a `/memberships` 400 (code 9106)** using the API token alone,
  even though the token had D1/Queues/Workers Scripts edit permissions — `wrangler` tries to resolve
  the account by listing memberships first, which needs a permission scope the token didn't have.
  Fixed by passing `CLOUDFLARE_ACCOUNT_ID` explicitly, which skips that lookup entirely.
- **`wrangler queues create` failed** with "message_retention_period must be between 60 and 86400
  seconds" — the CLI's own default (`--message-retention-period-secs 345600`, i.e. 4 days) exceeds
  this account's actual cap (1 day), which is stricter than what `wrangler --help` documents as the
  valid range (up to 1209600). Fixed by passing `--message-retention-period-secs 3600` explicitly.
- **`wrangler d1 execute --remote --file=seed.sql` failed** on the file's own `BEGIN TRANSACTION;` /
  `COMMIT;` wrapper — D1's remote execution manages transactions itself and rejects manual SQL-level
  transaction statements. Fixed by seeding remote D1 from a stripped copy (same INSERT statements,
  `PRAGMA`/`BEGIN`/`COMMIT` lines removed) rather than editing `seed.sql` itself, since the local
  `wrangler d1 execute --local` / in-memory sqlite validation path (used throughout the build and in
  `pnpm db:seed`'s documented workflow) has no such restriction and the committed file should keep
  working for that path unchanged.
- Real credentials (Cloudflare API token, Shopify access token) were stored only in the session
  scratchpad (`/tmp/.../scratchpad`, outside the repo, never git-tracked) and passed to `wrangler` via
  environment variables per-command, never written into any committed file. The Gemini key is the one
  exception: it lives in local `.dev.vars` (gitignored) per the project's existing local-dev
  convention, and was additionally set as a real Worker secret via `wrangler secret put` for
  production.
- Inserted one additional real `storefronts` row (new ULID, `shop_domain =
  'meanmachines-o33nvg56.myshopify.com'`) alongside the existing seeded demo storefront, both under
  the same seeded demo `users` row (`clerk_user_id = 'dev-user'`) — so the dashboard's login and demo
  dataset keep working exactly as before, while real Shopify webhooks now also have a matching
  storefront to land against. No real supplier exists yet, so `evaluate-margin` will use the two
  seeded fictional suppliers (still mock-priced, since `SUPPLIER_API_KEY` stays a placeholder) for any
  real order until the user configures one — flagged to the user as a known limitation of "live but
  supplier not yet real."
- `wrangler.toml`'s `[vars]` flipped to `MOCK_MODE = "false"` / `ENVIRONMENT = "production"` now that
  Shopify + Gemini have real secrets; 17TRACK/Clerk/supplier stay mocked automatically via their own
  per-key placeholder detection (`isMockMode`), not by any additional config — exactly the behavior
  this two-tier check was designed for back in milestone 4.

---

# Phase 2 — Multi-Marketplace Dropshipping Automation

Extends the deployed Phase 1 platform (Shopify-only, single-supplier-pattern) into a multi-marketplace
(eBay, Amazon, Shopify), multi-supplier-kind (API + manual/Chrome-extension) platform. Same autonomy
rules as Phase 1: no pausing for input, missing credentials get an adapter + mock, everything green
before each `phase2(N)` commit.

## Milestone 1 — schema migrations + seed extension
- `webhook_events.source` was deliberately left unchanged (`'shopify' | '17track' | 'email'`), not
  extended with `'ebay'` / `'amazon'` — per spec sections 5a/5b, marketplace order ingestion is
  **polling** (`OrderSource.listNewOrders(since)`, `storefronts.last_polled_at` as the cursor), not
  inbound webhook push, so there is no "eBay webhook" to HMAC-verify or dedupe the way Shopify's
  `orders/create` webhook works. `orders.raw_payload_id` was already nullable in the Phase 1 schema,
  so polled marketplace orders simply have `raw_payload_id = NULL` — no schema change needed there.
  (eBay does have an optional real-time notifications API; if that's wired up later, `'ebay'` can be
  added to the `webhook_events.source` check then, following the same HMAC-verify-and-dedupe pattern
  already established for Shopify/17TRACK — noted here rather than speculatively building it now.)
- `suppliers.kind`/`provider`/`onTimeRate`/`priority` all got explicit `NOT NULL DEFAULT` values
  (`'api'`, `'generic_rest'`, `1.0`, `0`) specifically so the migration stays purely additive — SQLite's
  `ALTER TABLE ADD COLUMN` requires a default for any NOT NULL column added to a table with existing
  rows, and the two Phase 1 seed suppliers (Acme, Globex) needed to end up with sensible values
  post-migration without a manual backfill step. `avgShipDays`/`stockConfidence` were left nullable
  instead (no natural "unset" numeric default for a real-valued shipping-performance metric) — verified
  by round-tripping the Phase 1 `seed.sql` unchanged through the new schema (still applies cleanly,
  existing suppliers land as `kind='api', provider='generic_rest'`, exactly the generic-REST shape they
  already had).
- `storefronts.platform`'s CHECK constraint change and `suppliers`' two new CHECK constraints forced
  drizzle-kit into its "create __new_table, copy rows, drop, rename" strategy for those two tables
  (SQLite can't `ALTER` a CHECK constraint in place) — same mechanism seen in Phase 1's own migration
  generation, not a new concern, just confirming it still works correctly with data present this time
  (validated by chaining both migrations + the old seed.sql through an in-memory SQLite DB, exactly as
  Phase 1's milestone 3 did).
- `tracking_events` gained a `createdAt` timestamp column beyond what the spec's field list named
  (`id, fulfillment_id, original_tracking, proxy_tracking, proxy_carrier, status, raw_status`) — every
  other table in the schema has one, and without it this table would be a single overwritten "current
  state" row rather than a genuine append-only event log, which is what a *tracking events* table
  needs to be to support the eventual "delivery monitoring" milestone (multiple status updates per
  fulfillment over the shipment's lifetime). Its `status` column reuses the exact same 5-value
  vocabulary as `fulfillments.trackingStatus` (`pending/in_transit/delivered/exception/needs_review`)
  for consistency rather than inventing a parallel enum; `raw_status` holds the carrier/17TRACK's
  original un-normalized status string, separate from our normalized `status`.
- `messages.trigger` / `message_templates.trigger` include `'stalled'` even though the spec's schema
  bullet for these tables only lists `sold, shipped, delivered, feedback_reminder` explicitly — the
  Buyer Engagement capability description at the top of the spec says "Auto-messages on
  sold/shipped/delivered/stalled", so `stalled` was added to both enums to keep the two spec sections
  consistent rather than silently dropping a capability named in the feature list.
- Seed data extended with: an eBay storefront (`non_api_mode=1`, demonstrating the Chrome-extension
  fallback path) and an Amazon storefront (both OAuth-shaped, `PLACEHOLDER__`-equivalent refs); four
  new suppliers covering every `provider` value (`amazon_business`, `aliexpress`, `cj`, and a
  `kind='manual'` `amazon_retail` supplier); three new orders demonstrating (a) an Amazon-Logistics
  (`TBA...`) tracking number actually proxied to a `BCE...` number in `tracking_events` — the literal
  scenario the Tracking Conversion milestone must handle — (b) a `manual_tasks` row sitting `pending`
  in what will become the Buy Queue, and (c) a plain USPS-tracked order proving the *negative* case
  (non-Amazon-Logistics carriers are pushed straight through, no proxy row's `proxy_tracking` populated)
  alongside two `messages` rows (`delivered` sent, `feedback_reminder` pending) and one `listings` +
  `supplier_offers` pair with two competing offers already scored, so every Phase 2 dashboard page
  planned in later milestones (Buy Queue, Catalog/Listings, Tracking, Messages) has non-empty seed data
  from milestone 1 onward, matching the same "every page non-empty" convention Phase 1's seed followed.

## Milestone 2 — OrderSource interface refactor + eBay adapter
- **Shopify does not implement `OrderSource`.** The interface (`listNewOrders`, `getOrder`,
  `pushTracking`, `sendBuyerMessage`, `listListings`, `updateListing`, `pauseListing`) is shaped for
  polling-based marketplaces, and Shopify already has a strictly better mechanism — real-time webhook
  push, HMAC-verified and deduplicated, live in production since Phase 1. Wrapping it into a generic
  polling interface would mean either (a) faking a `listNewOrders(since)` that just re-polls Shopify
  needlessly when a push channel already exists, or (b) leaving it unimplemented/throwing, which
  provides no value. "Extend, do not rewrite" is read literally here: `OrderSource` is a new interface
  for the new marketplaces; Shopify's Phase 1 code path is untouched.
- **`pushTracking`'s non-API-mode behavior is a thrown `NonApiModeError`, not a silent branch.** When
  `nonApiMode` is true, `RealEbayOrderSource.pushTracking` (and the mock, identically) throws a typed
  error carrying the order id + tracking payload, rather than trying to perform the DOM-upload dispatch
  itself. The adapter's job is talking to eBay's API; deciding what to do when that's *not* the right
  channel is a caller-level (workflow) concern — this mirrors the existing convention that adapters
  never touch D1 or make routing decisions on their own.
- **No new table for the Chrome-extension tracking-upload queue.** The spec's own field list for new
  tables (section 4) doesn't include one, and the natural candidate for reuse — `manual_tasks` — doesn't
  fit (its `supplier_id` is `NOT NULL`, but a tracking-upload task has no associated supplier purchase,
  only an existing fulfillment). Instead, the extension's "what needs uploading" queue is just a read
  over already-existing columns: `fulfillments` rows with `pushed_to_storefront = 0`,
  `tracking_number IS NOT NULL`, whose owning `storefronts.non_api_mode = 1`. This needs zero schema
  changes and will be exposed as a dedicated API route in the Chrome-extension milestone.
- **Rate limiting (hard rule) implemented once, shared by every real marketplace/supplier adapter**:
  `packages/adapters/src/rateLimit.ts` exports a pure, clock-injectable `TokenBucket` plus
  `fetchWithBackoff` (jittered exponential backoff on 429/5xx, passes through everything else
  immediately). It has no dependency on eBay specifically — Amazon/AliExpress/CJ real adapters
  (milestones 3-4) reuse it as-is rather than each inventing their own limiter.
- **eBay's real adapter's exact endpoint shapes (buyer messaging via Post-Order API `casemanagement`,
  Inventory API price/quantity split between `offer` and `inventory_item` resources) are written to
  match eBay's publicly documented REST API structure as closely as possible without a live sandbox
  app to verify against** — flagged as a `TODO(HUMAN)` in the adapter code and will be listed in
  DEPLOY.md's eBay section alongside the other Phase 1 adapters that were built the same way (Shopify,
  17TRACK) and never exercised against a live account during the unattended build itself.

## Milestone 3 — Amazon SP-API adapter + RDT integration
- **RDT is a genuinely separate token from the LWA access token, requested per-order, scoped to exactly
  one restricted resource path** — `fetchShippingAddress()` first calls
  `POST /tokens/2021-03-01/restrictedDataToken` (using the normal LWA token) with
  `restrictedResources: [{ method: 'GET', path: '/orders/v0/orders/{id}/address', dataElements:
  ['buyerInfo','shippingAddress'] }]`, then uses the returned `restrictedDataToken` — not the LWA
  token — as the `x-amz-access-token` for the actual address GET. This is specifically unit-tested
  (`real.test.ts`) by asserting the address-fetch call's access-token header is the RDT and explicitly
  is *not* the LWA token, since "RDT handling is mandatory for PII" is exactly the kind of requirement
  that's easy to silently regress (e.g. by accidentally reusing `this.tokens.accessToken` everywhere)
  without a test that specifically distinguishes the two tokens.
- **No full AWS SigV4 request signing.** Modern SP-API self-authorized apps (the standard shape for a
  single-seller integration, as opposed to a published third-party app serving many sellers)
  authenticate with the LWA access token alone via `x-amz-access-token`; SigV4 is only required for a
  narrower set of legacy/MWS-compatibility operations that this adapter never calls. Documented inline
  and in DECISIONS rather than silently omitted, so a future reader doesn't assume it's missing by
  oversight.
- **`pushTracking` only submits the Feeds API request; it does not poll for feed-processing completion.**
  Amazon's fulfillment-confirmation feed is inherently async (submit → Amazon processes on its own
  schedule → optionally poll `GET /feeds/2021-06-30/feeds/{feedId}` for a terminal status) — polling to
  completion is multi-second-to-minutes slow-path work that belongs in a Workflow step, not inside a
  single adapter method call, per the hard rule that slow work never happens in a request path. The
  adapter's contract ends at "the feed was successfully submitted to Amazon"; a later milestone's
  Workflow step is responsible for polling/reacting to eventual feed-processing failures if that's
  needed.
- **`sendBuyerMessage` maps to the `unexpectedProblem` Messaging API action**, the closest of Amazon's
  fixed, anti-spam-restricted message templates to a general "here's a text update" use case (Amazon's
  Messaging API has no free-text/arbitrary-body endpoint) — flagged as a `TODO(HUMAN)` needing real
  message-content classification (shipping delay vs. order confirmation vs. warranty, etc.) before
  production use, listed in DEPLOY.md alongside eBay's equivalent messaging caveat from milestone 2.
- **`listListings`/`updateListing` use the newer Listings Items API** (`/listings/2021-08-01/items/...`,
  JSON-Patch-style attribute updates for `purchasable_offer`/`fulfillment_availability`) rather than the
  older asynchronous Reports API (`GET_MERCHANT_LISTINGS_ALL_DATA`), which would require a
  create-report → poll → download-document flow — the same "no slow polling inside a single adapter
  call" reasoning as the Feeds API above ruled it out for a synchronous `listListings()` call. Endpoint
  field shapes are approximate (Amazon's actual JSON structure for `purchasable_offer`/
  `fulfillment_availability` attributes varies by product type schema); flagged as another
  `TODO(HUMAN)` verification item.
