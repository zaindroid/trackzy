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

## Milestone 4 — Supplier API Adapters (Amazon Business, AliExpress, CJ)
- **New `SupplierApiClient` interface (`packages/adapters/src/supplierApi/iface.ts`), separate from
  Phase 1's existing `SupplierClient`** (`packages/adapters/src/suppliers`) — same reasoning as the
  Shopify/OrderSource split in milestone 2. Phase 1's `SupplierClient.getPrice/createOrder` pair keeps
  serving the existing, already-tested, already-deployed `OrderWorkflow` fulfillment path untouched.
  The new interface (`searchProduct`, `getOffer`, `createOrder`, `getTracking`) is what spec section 6
  actually asks for and Phase 1's interface has no room for (no product search, no stock/ship-day
  signal, no tracking lookup) — extending Phase 1's interface in place would have meant either breaking
  its two existing call sites in `orderLogic.ts` or bolting on four unrelated optional methods that
  existing suppliers (Acme/Globex, both `provider: 'generic_rest'`) don't implement.
- **AliExpress's HMAC-SHA256 request signing is pulled into its own pure module** (`sign.ts`) purely so
  it's independently unit-testable without any network mocking — sorting-independence (same signature
  regardless of input object key order, since the function sorts before concatenating), per-field
  sensitivity (any single value change flips the signature), and secret-sensitivity are all asserted
  directly. This is the same "isolate the one genuinely risky/distinctive piece of logic and test it in
  isolation" approach used for Amazon's RDT flow in milestone 3.
- **CJ Dropshipping's `CJ-Access-Token` is taken as a pre-obtained secret (`CJ_API_KEY`), not fetched by
  this adapter via CJ's email+password login endpoint.** CJ's token is long-lived (~15 days per their
  docs) rather than a short-lived OAuth access token needing per-request refresh logic like eBay/Amazon,
  so there's no ongoing refresh mechanics to build — and keeping the actual account password out of the
  Worker's request path entirely (obtained once, out-of-band, by a human) is simply safer. Documented as
  a `TODO(HUMAN)` in DEPLOY.md alongside the other credential-acquisition steps.
- **All three real adapters reuse `packages/adapters/src/rateLimit.ts` from milestone 2 as-is** — no new
  rate-limiting code was written, confirming the shared utility's design goal (write once, every real
  marketplace/supplier adapter reuses it) actually held up in practice.
- **`createSupplierApiClient(provider, env)` dispatches on the exact same `suppliers.provider` enum
  values** added to the schema in milestone 1 (`'amazon_business' | 'aliexpress' | 'cj'` — deliberately
  excluding `'amazon_retail'`, `'generic_rest'`, and `'manual'`, which route through Phase 1's
  `SupplierClient` or the manual-task flow instead, not this new interface) — this factory is what the
  catalog-scoring milestone (8) will call to fetch competing offers across suppliers for a given
  listing.

## Milestone 5 — Gmail OAuth ingestion pipeline + extraction logic
- **Extended `Carrier` with `'AMZL'` (Amazon Logistics) in `packages/core`, ahead of milestone 7's
  tracking-proxy work**, because `parseAmazonRetail`'s output needed to type-check *now* — the parser
  declares `carrierDeclared: 'AMZL'` when the source email says "Carrier: Amazon Logistics", and that's
  a genuine carrier-detection primitive (a `TBA` + 12-digit format validator, weak/format-only like
  FedEx, since Amazon publishes no checksum) that belongs in `packages/core/src/carriers` alongside
  UPS/USPS/FedEx/DHL regardless of which milestone needed it first. `detectCarrier`'s chain now checks
  AMZL right after the declared-carrier check (its `TBA` prefix is as unambiguous as UPS's `1Z`).
  17TRACK's real adapter's `Record<Carrier, number>` carrier-code map had to gain an `AMZL` entry to keep
  typechecking — filled in with a plausible code and the same `TODO(HUMAN): verify against live` caveat
  already used for entries added in Phase 1.
- **`extractTrackingCandidate` (regex-parser-first, Gemini-fallback) was pulled out of `email.ts` into
  `apps/worker/src/lib/extractTrackingCandidate.ts`**, and `resolveSecretRef` out of
  `webhooks.shopify.ts` into `apps/worker/src/lib/secretRef.ts` — both were private, single-use helpers
  in Phase 1 that Gmail ingestion now needs identically. This is the literal "reuse, don't rewrite"
  instruction: `email.ts` and `gmailIngestion.ts` now both call the same two shared functions rather
  than each carrying its own copy, and `email.ts`'s existing tests were left untouched (still green)
  since the refactor is a pure extraction with no behavior change.
- **Gmail OAuth tokens live on `users`, not a new table** (`gmailRefreshTokenRef`, `gmailAccessTokenRef`,
  `gmailTokenExpiresAt`, `gmailLastPolledAt` — all nullable, so the migration is a plain multi-column
  `ALTER TABLE ADD` with no table recreation needed). Gmail is a per-*user* connected inbox, not a
  marketplace/storefront and not scoped to any one supplier, so neither `storefronts` (already extended
  with OAuth fields in milestone 1, but conceptually "a marketplace connection") nor a new table fit as
  well as extending `users` the same way `storefronts` was already extended.
- **Gmail-sourced tracking resolution reuses the exact same FIFO-per-supplier heuristic** Phase 1's
  `email.ts` established ("oldest fulfillment for this supplier still awaiting tracking") rather than
  inventing a more precise correlation — consistent with the instruction to reuse existing conventions,
  and appropriate since spec section 6b groups Gmail polling with inbound email as one ingestion family
  rather than asking for a different correlation strategy.
- **Scheduling: one `scheduled()` export, dispatching on `event.cron`** (`apps/worker/src/scheduled.ts`),
  rather than a Workflow — Gmail polling is a fixed-interval sweep with no per-message durable state to
  track across steps, which is exactly what a Cron Trigger is for; Workflows are for the *fulfillment
  order lifecycle's* durable multi-day state, not a "run this function every 5 minutes" scheduler. The
  dispatch-on-`event.cron` shape is deliberate: Workers only allows one `scheduled` export per Worker, so
  milestone 8's hourly repricing sweep will extend this same function with a second `if (event.cron ===
  ...)` branch rather than needing a second entry point.
- **Testing avoids invoking the Workers-level `scheduled()` trigger machinery entirely** — `pollGmailForUser`
  (the actual logic) is unit-tested directly against the real D1 test database, exactly like
  `runOrderWorkflow`/`runDisputeWorkflow` in Phase 1's milestone 6. This sidesteps needing
  `vitest-pool-workers`' `SELF.scheduled()` helper and keeps the test asserting on behavior
  (fulfillment resolved, webhook_events deduped, cursor advanced) rather than on Workers runtime
  plumbing.

## Milestone 6 — Manual Task flow + Manifest V3 Chrome Extension scaffold
- **Buy Queue lifecycle lives at `/api/manual-tasks` (list/claim/mark-ordered/abandon), the two
  extension-specific reads/writes at `/api/extension/*`** (`active-manual-task`,
  `pending-tracking-uploads` + `.../complete`) — kept in separate route files because they serve two
  different audiences (the dashboard's Buy Queue page lists/manages tasks broadly; the extension polls
  narrowly for "what should I show right now on this page"), but both mount under the same
  Clerk-authed `/api/*` sub-app and reuse the same bearer-token convention — the extension's popup
  stores the same kind of token the dashboard does (`dev-user` in MOCK_MODE), so no separate auth
  scheme was needed for the extension.
- **`GET /api/extension/active-manual-task` returns the single oldest `claimed` task, with no
  domain-matching** — the schema (spec section 4, followed literally in milestone 1) gives suppliers no
  "checkout domain" column to match a content script's current page against, so a more precise
  "which task belongs on *this* checkout page" lookup isn't buildable from the given schema. Documented
  as a real limitation of a single-tenant scaffold rather than silently adding an unlisted column.
- **`GET /api/extension/pending-tracking-uploads` still reuses the plain `fulfillments`-column read
  designed in milestone 2's DECISIONS.md** (`non_api_mode` storefront + `pushed_to_storefront=0` +
  `tracking_number IS NOT NULL`) rather than a dedicated queue table — this milestone is where that
  design actually gets exercised end-to-end for the first time, confirming the earlier call didn't need
  revisiting once the real consumer (the extension) existed.
- **Chrome MV3 content scripts cannot `import` a shared chunk** — Chrome loads everything listed under
  `manifest.json`'s `content_scripts` as a classic (non-module) script, so a naive multi-entry Vite/ES-module
  build that code-splits a shared `lib/api.ts` into `chunks/api.js` silently produces a broken extension
  (the content script's own `import` statement is a syntax error in a classic-script context — this
  would only surface as a real bug once loaded in an actual browser, so it was caught here specifically
  by inspecting the build output for top-level `import`/`export` statements). Fixed with four separate
  single-entry `vite build` invocations (`vite.config.ts` for the popup's normal HTML/ES-module entry;
  `vite.background.config.ts`, `vite.content-checkout.config.ts`, `vite.content-ebay-tracking.config.ts`
  each building one IIFE-format entry with `emptyOutDir: false` so they don't clobber each other's
  output) rather than adding `@crxjs/vite-plugin` or a similar dependency — plain Vite/Rollup config
  already solves this once each content script and the background worker are built as their own
  self-contained bundle; `lib/api.ts`'s code ends up duplicated across `content-checkout.js` and
  `content-ebay-tracking.js`, an acceptable tradeoff given both files are a few KB and content scripts
  run in isolated execution contexts anyway (no shared-module benefit to lose).
- **`addressMapping.ts`'s pure mapping logic (shipTo fields → `{selector, value}` pairs) is deliberately
  separated from the actual DOM injection in `content/checkout.ts`** specifically so it's the one part
  of the checkout-paste flow that's genuinely unit-testable without a real browser or a live Amazon
  checkout page — the selector *values* themselves (`DEFAULT_AMAZON_CHECKOUT_SELECTORS`) are a
  best-effort guess flagged `TODO(HUMAN)`, matching the same "can't verify against a live account, so
  document the gap and test what's actually testable" approach used throughout Phase 2 for eBay/Amazon/
  AliExpress/CJ's exact endpoint shapes.
- **`@types/chrome` added as a new dependency** (`apps/extension`) — justified: it's the standard,
  necessary type-definition package for any TypeScript Chrome extension (`chrome.storage`,
  `chrome.alarms`, `chrome.runtime` all need it to typecheck), with no reasonable substitute.
- **`apps/extension` is excluded from the root `pnpm build` script** (which Phase 1 defined as
  specifically "produces the deployable worker") but included in `pnpm typecheck`/`pnpm test` via the
  existing `pnpm -r` recursion, and gets its own `pnpm build:extension` — both are now chained into the
  root `pnpm ci` script, so a milestone commit's "everything must lint, typecheck, and test green" check
  still covers it without conflating two genuinely different deployables (one Cloudflare Worker, one
  browser extension bundle) under one build command.

## Milestone 7 — Tracking Conversion Middleware (Bluecare Express / Aquiline)
- **The proxy decision (`shouldRouteThroughTrackingProxy`) is its own tiny, explicitly-tested function
  in `packages/core`**, not inlined into the middleware — spec section 11 explicitly requires "asserting
  TBA goes to proxy, USPS goes straight through" as a unit test, and the hard rule ("you MUST route it
  through a tracking proxy API") is exactly the kind of one-line condition that's easy to silently break
  in a larger orchestration function without a test pinned directly to it. It takes the destination
  platform as a plain string rather than importing `OrderSource`/`storefronts` types, keeping
  `packages/core` free of any Cloudflare/DB dependency, consistent with every other module there.
- **Both named providers implemented** (Bluecare Express and Aquiline), selected via
  `TRACKING_PROXY_PROVIDER` env var (defaults to Bluecare Express) — spec section 7's milestone title
  says "implementations" (plural) and names both as acceptable options, so rather than picking one and
  documenting the other as a TODO, both got a real adapter (same rate-limited-fetch shape as every other
  Phase 2 real adapter) and a deterministic mock. The two mocks intentionally produce visually distinct
  formats (`BCE<hex>` vs `AQL<hex>`) so which provider actually ran is obvious from the stored
  `proxy_tracking` value alone.
- **The middleware (`apps/worker/src/trackingUploader.ts`) is the single required call path for pushing
  tracking to a marketplace** — it resolves the fulfillment's destination platform itself (via a
  `fulfillments → orders → storefronts` join) rather than asking the caller to pass it, specifically so
  no future call site can accidentally call `OrderSource.pushTracking` directly and skip the proxy
  check. It always writes a `tracking_events` row (proxied or not) *before* attempting the marketplace
  push, so the audit trail (and, in the proxied case, the `original_tracking` → `proxy_tracking`
  mapping) is captured even if the push itself fails or the storefront is in `non_api_mode`.
- **`NonApiModeError` (thrown by eBay's `pushTracking` when `non_api_mode=1`, from milestone 2) is caught
  and treated as a valid outcome, not an error** — `pushed: false, proxied: true` is returned rather than
  propagating the throw, and `fulfillments.pushedToStorefront` deliberately stays `0`. This is the exact
  handoff point to the Chrome Extension's non-API upload queue built in milestone 6: the proxy
  conversion still happens (so the extension uploads the *compliant* number, not the raw `TBA...` one),
  but the actual DOM upload is left to a human via `POST /api/extension/pending-tracking-uploads/:id/complete`.
  This single test (`trackingUploader.test.ts`'s fourth case) is effectively where milestones 2, 6, and 7
  first prove they compose correctly end-to-end.
- **`NonApiModeError` is imported directly from `@fulfillment-tracker/adapters/ebay`** rather than a more
  generic error type on the `OrderSource` interface itself — currently eBay is the only marketplace with
  a non-API mode, so a marketplace-agnostic error type would be speculative generalization for a
  capability nothing else needs yet. Noted here as the one coupling point worth revisiting if a second
  marketplace ever grows its own non-API fallback.

## Milestone 8 — Catalog ops (scoring, matching, repricing, stock sync)
- **The matching cascade's first three stages (exact SKU, fuzzy title, embedding-similarity ranking) are
  pure functions in `packages/core`** (`fuzzyMatch.ts`, `matching.ts`) — they take already-scored
  candidates and decide whether there's an unambiguous winner, but never call an embedding API
  themselves. `packages/core` has zero Cloudflare/network dependencies by design (established in
  Phase 1), so the actual embedding generation happens in the Gemini adapter and gets threaded through
  by the worker-layer orchestrator (`apps/worker/src/catalog/matchListing.ts`). Fuzzy title similarity
  uses Dice's coefficient (bigram overlap) rather than Levenshtein or Jaro-Winkler — it needs no new
  dependency, is O(n), and is precise enough for short product-title strings; the "≥ 0.9" spec threshold
  and an "ambiguity margin" (candidates within 3 points of each other don't count as a clear winner) are
  both directly unit tested with hand-verified numeric fixtures (dice-coefficient scores were computed
  externally and checked before being hardcoded into test assertions, after two rounds of test-fixture
  corrections when initial hand-picked example titles didn't actually clear the thresholds I intended).
- **The `GeminiExtractor` interface grew two more methods** (`embedText`, `pickBestListingMatch`),
  updating the "ONLY call sites" doc comment from Phase 1's two to Phase 2's four — this is intentional,
  spec-authorized growth (hard rule section 2 explicitly names "SKU/listing matching (ambiguous cases
  only)" as one of exactly four allowed LLM call sites), not scope creep. `pickBestListingMatch` is
  constrained to choosing one of the caller-provided candidate ids (or a `"none"` sentinel in the
  response schema) — it can never return a product that wasn't in the candidate list, keeping the "LLM
  narrows an already-bounded decision, never invents one" property the dispute-drafting and
  extraction-fallback call sites also have.
- **The mock embedding is a deterministic hashed-bigram histogram** (64 buckets, L2-normalized) rather
  than a fixed/random vector — chosen specifically so mock-mode tests exercise *real* cosine-similarity
  behavior (similar titles genuinely score higher than dissimilar ones) instead of just returning
  canned numbers, the same "mocks should be genuine simplified implementations, not stubs" principle
  used for `MockGeminiExtractor.extractTracking`'s regex scan back in Phase 1.
- **`matchListing()` searches every active `kind='api'` supplier via `SupplierApiClient.searchProduct()`
  using the listing's own title as the query** to gather candidates, then runs the cascade across all of
  them combined (not per-supplier) — discovered empirically that the mock suppliers' `searchProduct`
  fixtures append a supplier-name suffix to the query (e.g. `"<title> (CJ Dropshipping)"`), which scores
  well below the 0.9 fuzzy-title threshold (~0.65-0.72, verified numerically), so realistic mock-mode
  matches resolve via the embedding stage — the worker-level test asserts on structural outcomes
  (a match was found and persisted, from a non-`exact_sku` source, since mock search results never carry
  a `sku`) rather than pinning to one specific cascade stage, since which stage wins depends on
  interacting hash functions not worth hand-verifying byte-for-byte.
- **Repricing/stock-sync target margin reuses `settings.minMarginPercent`** (the same per-user setting
  Phase 1's order-level margin evaluation already reads) rather than adding a separate
  "catalog target margin" field — one fewer setting for the user to reason about, and the spec doesn't
  distinguish "order margin" from "listing margin" as separate concepts. Marketplace fees are a flat
  `$0` placeholder (`TODO(HUMAN)`: eBay's final value fee ~13%, Amazon's referral fee 8-15% by category)
  since neither is knowable generically without per-category rate tables out of scope for this
  milestone; the price-change threshold (3%) is a hardcoded constant, not yet a user setting.
- **`createOrderSourceForStorefront` is a new shared helper** (`apps/worker/src/lib/`) resolving OAuth
  tokens + building the right `OrderSource` for a storefront, with the refresh callback persisting a
  renewed `oauthExpiresAt` back onto `storefronts` — pulled out as reusable specifically because both
  the repricing sweep (this milestone) and the messaging engine (milestone 9, not yet built) need "give
  me a live OrderSource for this storefront's platform" and neither should re-derive the OAuth
  credential-resolution plumbing independently. Returns `null` for Shopify (and any future platform
  without an `OrderSource` implementation) — callers skip the marketplace-push step gracefully rather
  than erroring, since a Shopify listing simply has no catalog-ops push path yet (Shopify's own Admin
  Products API would be a separate integration, out of this milestone's scope).
- **Stock-out pausing takes priority over repricing for a given listing** (checked and short-circuits
  before the reprice branch) — an out-of-stock listing gets paused and skipped in the same sweep pass
  rather than also being repriced against a supplier that can't currently fulfill it, avoiding a
  meaningless price update to a listing about to be paused anyway.

## Milestone 9 — Messaging engine + exceptions triage
- **`draftDispute` was extracted from `workflows/orderLogic.ts` into `apps/worker/src/lib/draftDispute.ts`**
  unchanged in behavior (`env.DISPUTE_WORKFLOW?.create(...)` wrapped in try/catch, same "binding absent or
  instance-id collision, either way best-effort" semantics documented back in Phase 1 milestone 6) — the
  17TRACK webhook route now needs the exact same "best-effort start a dispute workflow" call for a
  stuck/lost carrier-exception event that the order workflow already needed for a timed-out
  `await-tracking` step, and the instruction to extract shared helpers rather than duplicate logic (already
  the pattern for `extractTrackingCandidate`/`resolveSecretRef` in milestone 5) applied identically here.
  `orderLogic.ts`'s own call site and tests are unaffected — pure extraction, no behavior change.
- **The fourth and final authorized LLM call site (`classifyTrackingException`) only fires when the
  deterministic `STATUS_MAP` in `webhooks.tracking.ts` doesn't recognize the carrier's raw status string**
  — mirroring the exact "deterministic rules first, LLM only for what they can't classify" shape used for
  `extractTrackingCandidate`'s email-parsing fallback in Phase 1/milestone 5. The route's local `status`
  variable is deliberately typed as the broader 4-value union (`in_transit | delivered | exception |
  needs_review`) rather than reusing the Workflow's 3-value `TrackingStatusEvent['status']` — `needs_review`
  is a real, distinct outcome (a status Gemini itself couldn't confidently classify) that must not silently
  collapse into one of the other three; the workflow only receives a `tracking-status` event when `status
  !== 'needs_review'`, an explicit runtime guard that also satisfies TypeScript's narrowing.
- **Every 17TRACK event (mapped or not, resolved to a known fulfillment or not) writes a `tracking_events`
  row**, not just ones that change `fulfillments.trackingStatus` or reach the workflow — this is the
  append-only audit log the table was designed to be back in milestone 1, and "was this status ever seen
  and how did we classify it" needs to be answerable independent of whether it triggered a state change.
- **`sendBuyerMessage`/`scheduleFeedbackReminder` calls from the webhook route are all best-effort
  (`.catch(() => undefined)`)** — a messaging failure (e.g. the marketplace's message API rejects the
  call) must never fail the 17TRACK webhook response itself, since 17TRACK will retry a non-200 and the
  underlying tracking-status update already succeeded by that point. Same reasoning applied to the
  `'shipped'` trigger call added to `trackingUploader.ts`'s success path.
- **Message template rendering is plain `{{var}}` substitution against a small fixed var set (`sku`,
  `trackingNumber`, `carrier`), not an LLM** — buyer messaging is explicitly out of scope for the four
  allowed LLM call sites (hard rule section 2), and simple substitution is sufficient for the spec's
  named triggers; `DEFAULT_BODIES` provides a sensible fallback body per trigger when the user hasn't
  configured an active `message_templates` row for it, so the feature works out of the box in mock mode
  without seed data covering every trigger.
- **A storefront platform with no `OrderSource` implementation (Shopify) records `status: 'skipped'` for
  buyer messages, not an error** — reuses `createOrderSourceForStorefront`'s existing `null`-for-Shopify
  contract (milestone 8) rather than adding special-casing in the messaging engine; a `messages` row is
  still written so the attempt is visible in the dashboard, just marked as not actually sent.
- **Feedback reminders are a two-phase, age-gated flow** (`scheduleFeedbackReminder` inserts a `pending`
  row immediately on delivery; `processPendingFeedbackReminders(env, minAgeMs)` — run from the same hourly
  cron branch as milestone 8's repricing sweep — only sends rows older than `minAgeMs`, default 3 days)
  rather than sending immediately on delivery, per the spec's own framing ("feedback reminders" implies a
  deliberate delay, not an instant message indistinguishable from the delivery notification itself). The
  age threshold is a plain function parameter (not yet a user setting) so it's directly testable without
  manipulating wall-clock time.
- **Two `webhooks.tracking.test.ts` cases assert only on the `'stalled'` buyer message and a clean 200
  response, not on a `disputes` table row**, for a stuck/lost exception event — `wrangler.test.toml`
  (documented limitation since Phase 1 milestone 5) has no `[[workflows]]` bindings, so
  `env.DISPUTE_WORKFLOW` is `undefined` in every worker test and `draftDispute`'s optional-chained
  `?.create(...)` is a guaranteed no-op in this environment. The actual `disputes`-row-writing behavior
  lives inside `DisputeWorkflow.run()` and is already covered directly by
  `workflows/disputeLogic.test.ts` — asserting on an unobservable table here would be testing the test
  harness's binding gap, not real behavior.

## Milestone 10 — Final Polish

- **The worker's `Env` interface (`apps/worker/src/env.ts`) had a real, silent completeness gap**:
  `AQUILINE_API_KEY` and `TRACKING_PROXY_PROVIDER` were read by `createTrackingProxyClient` (milestone
  7) via the adapters package's own narrower `TrackingProxyEnv` type, but never declared on the
  worker's `Env` at all — TypeScript's structural typing let `trackingUploader.ts` pass `env: Env` to a
  function expecting `TrackingProxyEnv` without complaint, since a type missing an *optional* property
  is still assignable to one that declares it optional. Caught while writing this milestone's
  completeness pass (grepping every `env.SOME_VAR` reference across `packages/adapters/src` and
  `apps/worker/src` and diffing against `Env`'s declared fields), not by any failing test — the gap was
  real but invisible to `tsc`. Also found and added: `EBAY_API_BASE_URL`, `AMAZON_SP_API_BASE_URL`,
  `AMAZON_BUSINESS_BASE_URL`, `ALIEXPRESS_GATEWAY_URL`, `CJ_BASE_URL`, `GMAIL_API_BASE_URL`,
  `GEMINI_EMBEDDING_MODEL` — all optional per-adapter base-URL/model overrides with working defaults,
  so nothing was ever actually broken at runtime, but `Env` is now the true source of truth for every
  environment variable any adapter can read, matching the standard this project has held since Phase 1.
  `TRACKING_PROXY_PROVIDER` is typed as the adapter's exact literal union (`'bluecare_express' |
  'aquiline'`), not a bare `string` — a first attempt at `string` failed `pnpm typecheck` immediately
  (a `string` isn't assignable to a narrower literal-union field on the target type), which is exactly
  the kind of mismatch this polish pass exists to catch before it reaches a real deploy.
- **Writing the spec-required comprehensive MOCK_MODE e2e test surfaced a second, more serious bug**:
  `GET /api/extension/pending-tracking-uploads` (milestone 6) read `fulfillments.trackingNumber`
  directly, but `pushTrackingWithProxy` (milestone 7, built after and never cross-checked against
  milestone 6's endpoint) only ever persists the converted tracking number into `tracking_events`, not
  back onto `fulfillments`. A non-API-mode eBay fulfillment with an Amazon Logistics `TBA...` number
  would therefore have surfaced its *raw, un-proxied* number to the Chrome extension — meaning a human
  would paste the literal Amazon Logistics tracking number into eBay's own DOM, precisely what the hard
  architectural rule ("Amazon TBA→eBay tracking numbers MUST be proxied") exists to prevent. This is
  the clearest evidence yet for why spec section 11 requires one chained e2e test in addition to each
  milestone's isolated tests: milestones 6 and 7 were each fully green in isolation, but composed
  incorrectly. Fixed by having the endpoint join against the most recent `tracking_events` row per
  fulfillment and prefer its `proxyTracking`/`proxyCarrier` when present (`apps/worker/src/routes/api/extension.ts`),
  falling back to the fulfillment's own tracking number for the (more common) non-proxied case. The
  existing milestone-6 test (`extension.test.ts`) had been asserting against a hand-seeded fulfillment
  row that *already contained* the post-proxy value (`'BCE7F3A9D2E1'` written directly into
  `fulfillments.trackingNumber`) — which passed, but only because it never exercised the real
  `pushTrackingWithProxy` code path that actually produces that value, silently masking the gap. Fixed
  the test fixture to seed the *raw* `TBA...` number plus a separate `tracking_events` row (mirroring
  what the real code path actually produces) and added a second case proving the passthrough fallback
  still works when no proxy conversion was recorded.
- **The e2e test (`apps/worker/src/e2e/mockModeDropship.test.ts`) seeds its manual task directly rather
  than producing it via `matchListing()`** — spec section 11's own scenario prose says "eBay order →
  scored to Amazon Retail → manual task created," but no milestone actually wired automatic manual-task
  creation from order intake: `matchListing()`'s cascade (milestone 8) deliberately only searches
  `kind='api'` suppliers (a manual supplier has no `searchProduct()` to call), and Phase 1's
  `OrderWorkflow` — the only code that creates fulfillment-adjacent rows from a live order — was
  deliberately left untouched and Shopify-only per "extend, don't rewrite" (milestone 2). Building a new
  eBay/Amazon-aware order-orchestration workflow that also branches into manual-supplier task creation
  was never one of the 10 explicit milestones; each milestone built one capability in isolation on the
  understanding that a future integration milestone would wire full order-to-fulfillment orchestration
  for the new marketplaces. Rather than silently paper over this with an implicit assumption, the test
  seeds the manual task directly (documented inline) and proves every *downstream* piece — claim,
  extension read, mark-ordered, Gmail resolution, tracking proxy, non-API queue, delivery, messaging —
  composes correctly once given a starting manual task, which is exactly what was buildable within this
  session's 10 milestones and is the same "test what's actually testable, document the rest" approach
  used throughout Phase 2 for every external-API shape that couldn't be verified against a live
  account.
- **DEPLOY.md's Phase 2 sections (8–15) follow Phase 1's exact per-service structure** (a numbered
  section per credential/account, each with a `TODO(HUMAN)` marker and the precise `wrangler secret
  put` commands) rather than a single combined "set all these env vars" section — consistent with the
  existing document's own convention and easier for a human to work through one integration at a time
  rather than needing every credential before testing any single piece. Deploy became step 16 (was 8),
  pushed down to make room; its content is otherwise unchanged from Phase 1 except noting
  `pnpm build:extension` as a separate, non-bundled build step.
- **`.dev.vars.example` was extended with every Phase 2 environment variable** — the ~19 credential
  secrets named in the original build spec plus several optional base-URL/model overrides (commented
  out, defaults noted inline) uncovered during this milestone's `Env`-completeness pass above — under a
  clearly delimited "Phase 2" banner section, each following the exact same `PLACEHOLDER__` convention
  Phase 1 established — so `MOCK_MODE`'s own placeholder-detection continues to correctly identify
  every Phase 2 adapter as unconfigured out of the box, with no separate mock-detection logic needed
  for the new variables.

## Post-milestone-10 — OAuth access-token refresh persistence bug (found while going live with Gmail)

While walking the user through connecting a real Gmail inbox (first real Phase 2 credential wired up,
post-build), traced through what actually happens ~55 minutes after the first poll and found a real,
previously-untested bug: `gmailIngestion.ts`'s `onTokenRefreshed` callback (and the identical pattern
in `orderSourceForStorefront.ts` for eBay/Amazon) only persisted the refreshed token's `expiresAt`,
not the refreshed `accessToken` itself. Since the *token value* is resolved fresh on every invocation
from a `*_ref` column pointing at a static `env:GMAIL_OAUTH_ACCESS_TOKEN` secret (which never changes
after `wrangler secret put`), persisting only the expiry meant: after the first automatic refresh, the
DB would correctly say "not expiring soon" while actually still resolving to the *original*,
by-then-genuinely-expired access token — every poll after that point would silently fail with a 401
and never recover, since the stored expiry would never again look stale enough to trigger a real
refresh. This had zero test coverage before now: `RealGmailClient`'s refresh path is only reachable
through the *Real* adapter class, and every worker-level test runs in `MOCK_MODE` (`MockGmailClient`
has no refresh logic at all), so the bug was invisible to `pnpm test` despite being fully deterministic
and would have reproduced on literally every real deployment within about an hour of the first poll.
- **Fix: persist the refreshed access token as a literal value into the same `*_ref` column**, not a
  separate raw-token column — `resolveSecretRef` already documents and implements exactly this
  fallback (a ref either starts with `env:` and is resolved, or is returned as-is), so no schema change
  was needed, just actually using the escape hatch that was already designed in. Applied identically to
  `gmailIngestion.ts` (`users.gmailAccessTokenRef`) and `orderSourceForStorefront.ts`
  (`storefronts.oauthAccessTokenRef`) — the latter isn't live yet (eBay pending developer-account
  review, Amazon not started at time of writing) but carries the exact same bug and would have failed
  identically the first time either went live, so it was fixed now rather than deferred.
- **Added a real regression test** (`packages/adapters/src/gmail/real.test.ts`) at the one layer that
  can actually exercise this: constructs a `RealGmailClient` with an already-expired token, asserts the
  subsequent API call carries the newly-refreshed bearer token (not the stale one), and asserts
  `onTokenRefreshed`'s argument itself carries the real new `accessToken` value distinct from the
  original — directly guarding against silently regressing back to "only the timestamp is persisted."
  No equivalent worker-level test was added for `orderSourceForStorefront.ts`'s callback specifically,
  since MOCK_MODE makes that code path unreachable in every existing worker test the same way it does
  for Gmail — the adapter-level test plus identical code-review of the (structurally identical) second
  call site was judged sufficient given neither eBay nor Amazon is live yet.

## Post-milestone-10 — Phase 2 remote migration retrofit (KNOWN GAP: `storefronts.platform` CHECK)

Applying Phase 2 migrations 0001/0002 to the real, already-populated production D1 database (to bring
Gmail polling live) failed: `wrangler d1 migrations apply --remote` sends a migration file's statements
as one atomic D1 batch, and `PRAGMA foreign_keys=OFF` is a documented SQLite no-op once a transaction is
already open — confirmed empirically (a `PRAGMA foreign_keys=OFF` set via one `wrangler d1 execute
--remote` call had zero effect when queried back in a separate call: D1 does not keep a connection alive
across requests the way a persistent PRAGMA setting would need). This means the migration's `DROP TABLE
storefronts`/`DROP TABLE suppliers` (drizzle-kit's required strategy for their CHECK-constraint changes)
genuinely violates real foreign keys from `orders.storefront_id`/`fulfillments.supplier_id`, which have
real rows in production. Reproduced and confirmed locally via a Python `sqlite3` harness that seeds
Phase-1-shaped referencing data and applies the migration inside one transaction (matching D1's real
batching behavior) before touching anything live.

- **The migration files themselves (`0001_overjoyed_kree.sql`, `0002_sticky_warpath.sql`) were left
  byte-identical, uncommitted-to change.** They remain fully correct for their normal use case — a fresh
  database (every test run, local dev, and any future from-scratch deployment) has zero rows in any
  table, so the same `DROP TABLE` cannot violate any FK regardless of whether `PRAGMA foreign_keys=OFF`
  actually takes effect. Editing the committed files to work around the live-data case would have
  silently weakened the schema (dropped the `platform` CHECK) for every test and fresh install too —
  the wrong trade-off for a problem that is specific to one already-populated remote database.
- **Applied an FK-safe subset by hand instead**, covering everything that doesn't require dropping a
  referenced table: the six new tables verbatim (empty tables, no FK risk), and — critically — realized
  mid-fix that `suppliers`' new columns (`kind`, `provider`, etc.) and `storefronts`' new nullable OAuth
  columns don't actually need the drop-rebuild dance at all: they're brand-new columns, and modern
  SQLite (verified on 3.45, D1 confirmed compatible) supports `ALTER TABLE ADD COLUMN col ... CHECK(...)`
  in place, with zero rebuild and zero FK exposure. Migration 0002 (Gmail's four `users` columns) was
  always FK-safe on its own. Validated the exact hand-built statement list against the same local
  FK-referencing-data harness before running it against the real database, then executed it via
  `wrangler d1 execute --remote --file=...` and manually inserted rows into `d1_migrations` for both
  filenames so `wrangler d1 migrations apply` correctly reports "no migrations to apply" going forward
  and never attempts to re-run the (unsafe-for-this-database) original file.
- **The one piece deliberately left undone: `storefronts.platform`'s CHECK constraint still only allows
  `('shopify')` on the real remote database**, not `('shopify', 'ebay', 'amazon')` as `schema.ts` and the
  committed migration describe. Widening it safely requires rebuilding `storefronts` under FK
  enforcement, which — because `orders` (its child) also has real rows referencing it, and
  `order_line_items`/`fulfillments` (orders' children) do too, and `fulfillment_line_items`/`disputes`
  (fulfillments' children) do too — cascades into needing a coordinated rebuild of up to seven real,
  data-bearing tables in the correct dependency order within one atomic D1 batch. That is real,
  invasive, easy-to-get-wrong surgery on production data that was not justified today: no eBay/Amazon
  storefront row exists yet to need it (eBay's developer account is still pending review). **This is a
  real, tracked blocker, not a resolved one**: attempting `INSERT INTO storefronts (..., platform,
  ...) VALUES (..., 'ebay', ...)` against the real database today will fail with a CHECK constraint
  violation. Before the eBay (or Amazon) storefront row is ever inserted for real, this must be solved —
  either the full cascading rebuild (planned, careful, ideally during a low-traffic window with a fresh
  `PRAGMA foreign_key_check` verification step at the end), or a deliberate decision to drop the
  DB-level CHECK entirely and rely on TypeScript's `text({enum:[...]})` compile-time enforcement alone
  (the application code path has never once constructed an insert with an invalid platform value, and
  never will, since the enum is exhaustively typed). Flagged loudly in DEPLOY.md's eBay section (8) so
  this isn't rediscovered the hard way mid-setup.
- **Deliberately did not edit `packages/db/migrations/meta/0001_snapshot.json`.** The snapshot describes
  drizzle-kit's understanding of the schema a *committed migration file* produces, which is still
  accurate — the file itself does correctly widen the CHECK when run against a fresh database. The
  divergence lives only in one already-deployed remote database's actual current state, which is an
  operational fact belonging in DECISIONS.md/DEPLOY.md, not in drizzle-kit's migration-generation
  bookkeeping. A future migration to actually complete the cascading rebuild will need to be hand-written
  (not `drizzle-kit generate`d, since `schema.ts` hasn't changed and drizzle-kit would see no diff to
  generate against) — noted here so that's not a surprise later.

## Post-milestone-10 — AliExpress adapter missing `session` (real functional gap, found before real setup)

While preparing to walk the user through connecting AliExpress as a real supplier, re-reading
`RealAliExpressClient` against how TOP-style (Taobao Open Platform-family) APIs actually authenticate
surfaced a genuine gap, not just a documentation caveat: every request was signed with `app_key`/
`app_secret` only. Those identify *the app*, not *which AliExpress dropshipping account* a call acts on
behalf of — account-scoped Dropshipping API methods (`aliexpress.ds.order.create`,
`aliexpress.ds.trade.order.get`) require a `session` system parameter (an OAuth access token) the
adapter never sent at all. This would have meant real order placement silently failing (or worse,
acting on the wrong/no account) the first time this adapter was actually exercised against a live app —
exactly the kind of gap that's invisible in MOCK_MODE (the mock never touches the real signing/request
path) and wouldn't have surfaced until a real integration attempt.
- **Added `ALIEXPRESS_ACCESS_TOKEN` as a static, pre-obtained secret** (not a full OAuth token-set +
  refresh-callback like eBay/Amazon/Gmail) — included as the `session` param only when set (an empty
  `session=` would be worse than omitting it, since some TOP implementations distinguish "no session
  provided" from "empty session"). This mirrors CJ's existing "acquired once, out-of-band" pattern
  rather than building a new OAuth-refresh subsystem into `SupplierApiClient` speculatively — AliExpress
  Dropshipping API session-token lifetimes aren't verifiable without a live app, so building automatic
  refresh now would be guessing at a token-expiry contract that might turn out wrong. Flagged as a
  `TODO(HUMAN)` in both the code and DEPLOY.md: if the real token turns out to be short-lived enough
  that manual renewal is impractical, extend this to the same pattern the other three OAuth-backed
  adapters already use.
- **`createAliExpressClient`'s mock-mode gate now also checks `ALIEXPRESS_ACCESS_TOKEN`** — previously
  only `ALIEXPRESS_APP_KEY`/`ALIEXPRESS_APP_SECRET` gated real-vs-mock, meaning a deployment with only
  those two set (and no session token) would have routed to the *real* client and made genuinely broken
  account-scoped calls instead of falling back to the mock. Now all three must be real, non-placeholder
  values before the real client is used.
- **New test** (`packages/adapters/src/supplierApi/aliexpress/real.test.ts`, not previously covered by
  any test) asserts `session` is present in the signed request body when the token is set, and — equally
  important — *absent* (not an empty string) when it isn't, directly guarding the fix against a silent
  regression back to "always send session, even blank."

## Post-milestone-10 — AliExpress upgraded from static token to full OAuth refresh (real account data)

The static-secret fix above was superseded within the same setup session, once the user's real
AliExpress Open Platform app showed its actual token lifetimes under "Auth Management": **1-day access
tokens, 2-day refresh tokens**. A static, never-refreshed secret (the CJ-style pattern the previous fix
used) would have broken within a day — this account's tokens are genuinely too short-lived for that
approach, confirming the "TODO(HUMAN): extend to full refresh if manual renewal proves impractical"
note left in the previous fix. Also confirmed, encouragingly: the App Console's "AliExpress-dropship"
API permission group was already `Active` immediately on app creation, alongside "System Tool" — no
separate approval step was needed in practice, resolving the uncertainty flagged in DEPLOY.md.
- **`suppliers` gained three nullable OAuth columns** (`oauth_access_token_ref`, `oauth_refresh_token_ref`,
  `oauth_expires_at`), migration `0003_clean_zemo.sql` — plain `ALTER TABLE ADD COLUMN`, no CHECK/FK
  involvement at all (unlike the `storefronts.platform` situation), so this one is safe to apply directly
  to the real remote database with no special handling. Mirrors `storefronts.oauth*`/`users.gmail*`
  exactly: `*_ref` columns holding either an `env:VAR_NAME` pointer or (after the first refresh) the
  literal current token value, per `resolveSecretRef`'s existing dual-mode contract.
- **`RealAliExpressClient`'s constructor now takes `(env, tokens, onTokenRefreshed)`** instead of just
  `env`, with a new `ensureFreshSession()` mirroring eBay/Amazon/Gmail's `ensureFreshToken()` — checked
  before every signed call, refreshing via a `method=auth/token/refresh` request through the same signed
  gateway (TOP-family APIs typically route auth operations through the same endpoint, not a separate
  REST path — flagged `TODO(HUMAN)` to verify the exact shape once tested against the account for real).
  A small local `AliExpressTokenSet`/`AliExpressOnTokenRefreshed` pair was defined in `aliexpress/iface.ts`
  rather than importing `OAuthTokenSet` from `orderSource/iface.ts` — same "keep SupplierApiClient and
  OrderSource decoupled" precedent from milestones 2/4, identical shape by convention, not by shared type.
- **New worker-level resolver** (`apps/worker/src/lib/supplierApiClientForSupplier.ts`), mirroring
  `createOrderSourceForStorefront` exactly: resolves a `suppliers` row's OAuth tokens for AliExpress
  specifically (all other providers still go through the unchanged, simpler `createSupplierApiClient`),
  with a refresh callback that overwrites `oauth_access_token_ref`/`oauth_refresh_token_ref` with the
  literal refreshed values. **`createSupplierApiClient('aliexpress', env)` now throws** rather than
  silently constructing a client with an empty session — the old env-only signature has no way to supply
  per-supplier tokens, so making the old call path fail loudly (with a message pointing at the new
  resolver) prevents it from ever being silently reintroduced by a future call site that doesn't know
  about the new requirement. `matchListing.ts`'s two call sites were updated to the new resolver;
  `index.test.ts`'s AliExpress dispatch test was rewritten to assert the throw instead.
- **Renamed the env secret from `ALIEXPRESS_ACCESS_TOKEN` to `ALIEXPRESS_OAUTH_ACCESS_TOKEN` +
  `ALIEXPRESS_OAUTH_REFRESH_TOKEN`**, matching the exact naming convention every other OAuth-backed
  secret in this codebase uses (`EBAY_OAUTH_*`, `AMAZON_OAUTH_*`, `GMAIL_OAUTH_*`) — these are now
  explicitly documented as *seed* values only, read once to bootstrap the first request; every
  subsequent refresh persists onto the `suppliers` row itself, not back into the static secret.
