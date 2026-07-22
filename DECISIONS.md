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
