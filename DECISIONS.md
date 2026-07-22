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
