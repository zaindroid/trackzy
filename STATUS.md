# Status — Definition of Done

Autonomous build session, milestones 1–9 complete. All items below were verified directly in this
sandbox (Node 20 installed user-local, pnpm via corepack — see DECISIONS.md "Environment").

**Update — Phase 2 (milestones 1–10) complete.** See the "Phase 2" section near the end of this file
for the multi-marketplace Definition of Done checklist; everything below this point describes the
original Phase 1 (Shopify-only) build and is left unchanged as a historical record.

## Checklist (spec section 13)

- [x] **`pnpm i && pnpm test && pnpm build` green from clean clone.**
  Verified repeatedly throughout the build after every milestone. Final state: 97 tests passing
  (45 `packages/core`, 24 `packages/adapters`, 25 `apps/worker` via `@cloudflare/vitest-pool-workers`
  against a real D1 instance, 3 `apps/dashboard` via Testing Library), zero lint errors, zero
  typecheck errors across all 5 workspace packages/apps, and `pnpm build` produces a deployable
  Worker (`apps/worker`'s `wrangler deploy --dry-run` succeeds against the real `wrangler.toml`,
  including the Workflows, Queues, D1, and Assets bindings) plus the static dashboard bundle it
  depends on.

- [x] **`pnpm dev` serves dashboard + API locally in MOCK_MODE with seeded D1; demo flow works** —
  with one honest caveat. Verified by hand: `wrangler dev` boots, `GET /` serves the dashboard shell,
  `GET /api/health` and every authed `/api/*` route return seeded data (orders, fulfillments,
  disputes, metrics all populated), and a real signed Shopify webhook (`POST /webhooks/shopify` with
  a correct HMAC over `fixtures/shopify/order-single-item.json`) was accepted, persisted to D1
  (order + line items visible via `GET /api/orders/:id`), and enqueued.
  **What did not run end-to-end locally**: the OrderWorkflow itself. `wrangler dev` (wrangler 3.114,
  Workflows "open beta") reports `ORDER_WORKFLOW`/`DISPUTE_WORKFLOW` as `[connected to remote
  resource]`, not `[simulated locally]` — unlike D1 and Queues, this wrangler version's Workflows
  don't execute fully offline even after the webhook→queue path fires correctly. Every other stage of
  "seed order → workflow → mock supplier ships → email fixture ingested → tracking validated → order
  shipped" **is** verified, just not chained through a live Workflow instance in this sandbox:
  the workflow's own step-by-step logic (margin evaluation, fulfillment-order lookup, supplier
  ordering, the split-shipment loop, dispute drafting) is exercised directly and passing in
  `apps/worker/src/workflows/*.test.ts` against a real D1 test database, and the email ingestion
  half of the pipeline (regex parse → Gemini fallback → carrier validation → fulfillment row update)
  is verified independently in `apps/worker/src/email.test.ts`. See DEPLOY.md's "Known limitation"
  section for the full detail and how to get a live Workflow run (a real, still-free, Cloudflare
  account).

- [x] **Zero LLM calls in pricing path (grep-proof), all external calls behind adapters.**
  `grep -rn "createGeminiExtractor" apps packages` (excluding tests) returns exactly two call sites:
  `apps/worker/src/email.ts` (extraction fallback) and `apps/worker/src/workflows/disputeLogic.ts`
  (dispute drafting) — nothing in `packages/core/src/margin.ts` or anywhere in the order-evaluation
  path imports an LLM client. Every other external system (Shopify, 17TRACK, generic supplier REST,
  Clerk) is called only through its `packages/adapters/src/<name>` interface, each with a
  fixture-backed mock selected automatically in `MOCK_MODE`.

- [x] **Every TODO(HUMAN) listed in DEPLOY.md with exact console URLs/steps.**
  `grep -rn "TODO(HUMAN)" --include="*.ts" --include="*.tsx" --include="*.toml" .` finds 5 markers
  (2 in `wrangler.toml`, 3 in code pointing back to DEPLOY.md); DEPLOY.md's 8 numbered sections cover
  all of them plus the platform-specific setup spec section 13 explicitly calls out: Cloudflare D1
  create, Cloudflare Queues create, Email Routing setup, Shopify app scopes
  (`read_orders, write_fulfillments, read_fulfillments`) + webhook registration, Clerk app creation,
  Gemini API key, and 17TRACK API key — each with the exact `wrangler`/console steps.

- [x] **`wrangler.toml` complete so that after filling secrets, deployment is exactly:
  `pnpm db:migrate:prod && wrangler deploy`.**
  `wrangler.toml` at the repo root declares every binding used by the Worker (D1, Queues producer +
  consumer + DLQ, both Workflows, Workers Assets serving `apps/dashboard/dist`, and the outbound
  `send_email` binding) and validates cleanly via `wrangler deploy --dry-run`. The only manual
  prerequisite is running `pnpm build` first so `apps/dashboard/dist` exists (documented inline in
  `wrangler.toml` and in DEPLOY.md step 8) — `pnpm build` is already the first half of the root
  `pnpm ci` pipeline, so any clean-clone build already produces it.

## What's mocked vs. real

Everything is mock-backed by default (`MOCK_MODE=true` in `wrangler.toml`'s `[vars]`, and every
adapter's own placeholder-key detection in `packages/adapters/src/mockMode.ts`). No real Shopify,
Gemini, 17TRACK, or Clerk credentials exist anywhere in this repository or were used during the
build. DEPLOY.md is the only path to a live deployment, and it was not exercised in this session per
the build's explicit instruction not to run a real `wrangler deploy`.

## Commit history

One commit per milestone (`milestone(N): <name>`), each preceded by a green `pnpm lint && pnpm
typecheck && pnpm test` (and `pnpm build` from milestone 8 onward, once the dashboard existed), plus
an interleaved `docs:` commit recording that milestone's non-obvious decisions in DECISIONS.md before
moving on. `git log --oneline` reflects this exactly.

---

# Phase 2 — Multi-Marketplace Dropshipping Automation

All 10 milestones complete (`phase2(1)` through `phase2(10)`), each preceded by a green `pnpm lint &&
pnpm typecheck && pnpm test && pnpm build && pnpm build:extension` and followed by a DECISIONS.md
entry for that milestone's non-obvious calls — see DECISIONS.md's "Phase 2" section for the full
reasoning behind every choice referenced below. No real marketplace/supplier credentials exist
anywhere in this repo; every adapter runs its fixture-backed mock (`MOCK_MODE=true`).

## Definition of Done (spec section 12)

- [x] **MOCK_MODE e2e demo passes end to end.**
  `apps/worker/src/e2e/mockModeDropship.test.ts` runs the full scenario spec section 11 names,
  chained through real code (not just individually-tested pieces): a non-API-mode eBay order's manual
  task (Amazon Retail supplier) is claimed and completed by the Chrome extension's endpoints, the mock
  Gmail inbox delivers the Amazon shipping-confirmation fixture, the resulting `TBA...` tracking
  number is proxied to a compliant Bluecare Express number, the non-API DOM-upload queue surfaces the
  *proxied* number (not the raw one — see the "real bug found" note below), the extension completes
  the upload, a Delivered 17TRACK webhook fires, and both the `delivered` buyer message and a pending
  `feedback_reminder` land correctly. One caveat, consistent with the "scored to Amazon Retail" step
  in the spec's own example: no milestone wired *automatic* manual-task creation from order intake
  (Phase 1's `OrderWorkflow` stayed Shopify-only, untouched, per "extend don't rewrite" —
  DECISIONS.md milestone 2), so the manual task is seeded directly rather than produced by a live
  matching step; `matchListing()`'s automatic cascade (milestone 8) is separately and thoroughly
  tested for the `kind='api'` supplier case it actually covers. Documented as a real scope boundary,
  not glossed over.

- [x] **Amazon TBA tracking numbers are correctly proxied.**
  Directly tested in `packages/core/src/trackingProxy.test.ts` (the pure routing decision),
  `apps/worker/src/trackingUploader.test.ts` (all four cases: proxied+pushed, passthrough+pushed,
  cross-platform passthrough, proxied+deferred-to-extension), and now the e2e test above. Writing this
  e2e test also **surfaced and fixed a real cross-milestone bug**: `GET
  /api/extension/pending-tracking-uploads` (built in milestone 6, before the proxy middleware existed)
  was reading `fulfillments.trackingNumber` directly, which is the *raw, un-proxied* number —
  `pushTrackingWithProxy` (milestone 7) only ever wrote the converted number into `tracking_events`,
  never back onto `fulfillments`. That meant the Chrome extension would have pasted a raw Amazon
  Logistics `TBA...` number into eBay's own tracking field, exactly the outcome the hard architectural
  rule exists to prevent. Fixed in `apps/worker/src/routes/api/extension.ts` to join against the most
  recent `tracking_events` row and prefer its `proxyTracking`/`proxyCarrier` when one exists, falling
  back to the fulfillment's own tracking number otherwise (the non-proxy-needed case). Covered by two
  new cases in `extension.test.ts` plus the e2e test's explicit `not.toBe('TBA123456789012')`
  assertion.

- [x] **Extension connects to backend for address pasting and tracking execution.**
  `apps/extension` (Manifest V3) has a popup, background service worker, and two content scripts
  (Amazon checkout paste, eBay tracking upload), all built as separate IIFE bundles
  (`pnpm build:extension`) to satisfy Chrome's classic-script restriction on `content_scripts` — see
  DECISIONS.md milestone 6. Backend connectivity is verified at the API layer: `active-manual-task`,
  `pending-tracking-uploads`, and `.../complete` all have route-level tests
  (`apps/worker/src/routes/api/extension.test.ts`) and are now also exercised end-to-end by the e2e
  test above. `addressMapping.ts`'s pure selector-mapping logic is unit tested; the actual DOM
  selectors (`DEFAULT_AMAZON_CHECKOUT_SELECTORS`, the eBay tracking-page selectors) are flagged
  `TODO(HUMAN)` in DEPLOY.md section 15 — they're a best-effort guess written without a live checkout
  session to verify against, the same documented-gap treatment used throughout Phase 2 for every
  marketplace/supplier endpoint shape that couldn't be checked against a real account.

- [x] **`pnpm test` is fully green.**
  257 tests passing across all workspaces: 90 `packages/core`, 95 `packages/adapters`, 66
  `apps/worker` (via `@cloudflare/vitest-pool-workers` against a real D1 instance — up from 25 at the
  end of Phase 1), 3 `apps/dashboard`, 3 `apps/extension`. `pnpm lint`, `pnpm typecheck`, `pnpm build`,
  and `pnpm build:extension` are all clean. `grep -rln "createGeminiExtractor" apps packages`
  (excluding tests and the adapter's own factory file) returns exactly four call sites —
  `extractTrackingCandidate.ts` (email fallback), `disputeLogic.ts` (dispute drafting),
  `matchListing.ts` (SKU/listing matching), `webhooks.tracking.ts` (carrier exception triage) —
  matching the hard architectural rule's exact allow-list, no more and no less.

## What's new vs. Phase 1

Order Sources: eBay (Sell APIs + non-API DOM-paste fallback), Amazon SP-API (with mandatory RDT for
PII). Suppliers: Amazon Business, AliExpress Open Platform, CJ Dropshipping (all `kind='api'`), plus a
`kind='manual'` Amazon Retail supplier routed through the Buy Queue + Chrome extension. Gmail OAuth
polling (5-min cron) as a second tracking-ingestion channel alongside Phase 1's inbound email. Tracking
Conversion Middleware (Bluecare Express default, Aquiline alternate) enforcing the Amazon→eBay proxy
rule. Catalog ops: SKU/listing matching cascade (exact SKU → fuzzy title → embedding → LLM-narrowed
ambiguous cases only), hourly repricing + stock-sync sweep. Buyer messaging engine (sold/shipped/
delivered/stalled + deferred feedback reminders) and carrier-exception triage (deterministic map, LLM
fallback for unmapped statuses only) — the third and fourth of exactly four authorized LLM call sites
in the whole codebase.

## What's still mocked

Every Phase 2 external service — eBay, Amazon SP-API, Amazon Business, AliExpress, CJ Dropshipping,
Gmail, Bluecare Express, Aquiline — runs its fixture-backed mock by default, identically to how Phase
1's Shopify/17TRACK/Clerk/generic-supplier mocks work. See DEPLOY.md sections 8–15 for the full,
numbered list of real-credential setup steps (none of which were exercised in this autonomous build,
per its explicit instruction not to attempt a real deploy).
