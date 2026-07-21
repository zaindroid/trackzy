# AUTONOMOUS BUILD: B2B Dropshipping Fulfillment Automation Platform

You are building a complete, production-grade, deployable product in one autonomous session. Do not stop to ask questions. Every decision you need has already been made in this document. Where a real credential or external account is required, use the placeholder convention below and keep building.

## 1. Mission

Build "Fulfillment Tracker" — an event-driven B2B dropshipping fulfillment automation platform. It replaces web scrapers with webhook + email ingestion. It receives storefront orders (Shopify), evaluates margin in plain code, fulfills via supplier APIs, extracts tracking numbers from supplier emails (regex first, Gemini Flash LLM as fallback only), validates them with carrier checksums, and pushes fulfillments back to Shopify via the Fulfillment Orders API. Idle cost must be $0: everything runs on Cloudflare free tier.

## 2. Autonomy rules (read carefully, they govern the whole session)

1. NEVER pause for user input. If information is missing, make the reasonable choice, document it in `DECISIONS.md`, and continue.
2. Missing credentials are NOT blockers. Use the placeholder convention in Section 10. Every external call must go through an adapter with a mock implementation so the entire system runs end-to-end locally with zero real credentials.
3. Work in this order and commit to git after each numbered milestone in Section 12 with message `milestone(N): <name>`.
4. Everything must build, typecheck, lint, and pass tests before a milestone commit. If a test fails, fix it before moving on. Never delete a failing test to make the suite green.
5. Do not add dependencies beyond those listed in Section 3 unless strictly necessary; if you add one, justify it in `DECISIONS.md`.
6. Do not deploy to real Cloudflare infrastructure (no `wrangler deploy` against a real account). Instead, make deployment a single documented command and verify everything with local simulation (`wrangler dev` / miniflare / vitest-pool-workers).
7. Finish with the Definition of Done checklist (Section 13) written into `STATUS.md` with every item checked or explained.
8. HARD ARCHITECTURAL RULES — violating any of these is a build failure:
   - No LLM anywhere in the margin/pricing/money path. Margin evaluation is pure TypeScript arithmetic.
   - LLM (Gemini Flash) is called in exactly two modules: email extraction fallback, and dispute email drafting. Nowhere else.
   - Every tracking number is checksum/format-validated before it can be written to a fulfillment or pushed to Shopify.
   - Every inbound webhook is HMAC-verified and deduplicated before processing.
   - All slow work happens in Cloudflare Workflows, never in the webhook request path. Webhook handlers must respond in <100ms of logic.

## 3. Locked tech stack

- Runtime: Cloudflare Workers (TypeScript, ES modules)
- HTTP framework: Hono
- Durable orchestration: Cloudflare Workflows (`cloudflare:workers` WorkflowEntrypoint)
- Database: Cloudflare D1 (SQLite) + Drizzle ORM + drizzle-kit migrations
- Queue: Cloudflare Queues (webhook fan-out only)
- Auth: Clerk (JWT verification at the edge via `@clerk/backend`; dashboard uses Clerk React components). Mock-able.
- LLM: Google Gemini Flash via REST (`generativelanguage.googleapis.com`), structured output (responseSchema). Mock-able.
- Tracking events: 17TRACK webhook + register API. Mock-able.
- Storefront: Shopify Admin GraphQL API (Fulfillment Orders). Mock-able.
- Frontend: Vite + React 18 + TypeScript + Tailwind CSS + TanStack Query + React Router. Served as static assets from the same Worker (Workers Assets) so there is ONE deployable unit.
- Package manager: pnpm, monorepo with pnpm workspaces.
- Testing: vitest + @cloudflare/vitest-pool-workers for Worker code; vitest + testing-library for frontend units.
- Lint/format: eslint + prettier, strict tsconfig (`"strict": true`, `noUncheckedIndexedAccess`).

## 4. Repository layout

```
fulfillment-tracker/
  package.json  pnpm-workspace.yaml  README.md  DECISIONS.md  STATUS.md  DEPLOY.md
  .dev.vars.example        # every env var with placeholder value
  wrangler.toml            # worker + workflows + d1 + queues + assets bindings
  packages/
    core/                  # pure logic, zero Cloudflare imports — fully unit-testable
      src/margin.ts        # margin math
      src/carriers/        # detection + checksums (ups.ts, usps.ts, fedex.ts, dhl.ts, detect.ts)
      src/parsers/         # per-supplier email regex parsers + parser registry
      src/types.ts         # shared domain types (Order, Fulfillment, TrackingCandidate...)
    db/
      src/schema.ts        # Drizzle schema (Section 5)
      src/index.ts         # db factory
      migrations/          # generated SQL migrations, committed
      seed.ts              # seed script: 1 user, 1 storefront, 2 suppliers, 6 orders in varied states
    adapters/              # every external service behind an interface + real + mock impl
      src/shopify/         # ShopifyClient: iface + real (GraphQL) + mock (fixture-backed)
      src/gemini/          # GeminiExtractor: iface + real + mock
      src/seventeentrack/  # TrackingEvents: iface + real + mock
      src/suppliers/       # SupplierClient iface + genericRest real impl + mock
      src/clerk/           # verifySession: real + mock (mock accepts token "dev-user")
  apps/
    worker/
      src/index.ts         # Hono app: routes below + static assets fallback
      src/routes/webhooks.shopify.ts   # POST /webhooks/shopify  (HMAC, dedup, persist, enqueue, 200)
      src/routes/webhooks.tracking.ts  # POST /webhooks/17track
      src/routes/api/*.ts  # authed JSON API for the dashboard (orders, fulfillments, suppliers, disputes, settings, metrics)
      src/email.ts         # email() handler for Cloudflare Email Routing (raw MIME in)
      src/queue.ts         # queue consumer -> starts/dispatches Workflow instances
      src/workflows/order.ts    # OrderWorkflow (Section 7)
      src/workflows/dispute.ts  # DisputeWorkflow
    dashboard/             # Vite React app, built into worker assets
      src/pages/{Orders,OrderDetail,Fulfillments,Suppliers,SupplierDetail,Disputes,Settings,Login}.tsx
      src/components/...
  fixtures/
    emails/                # >=6 raw MIME fixtures: 2 suppliers x (html tracking email, pdf invoice email), 1 malformed, 1 duplicate
    shopify/               # order webhook payloads incl. multi-line-item order
    gemini/                # canned structured-output responses
```

## 5. Database schema (Drizzle, D1/SQLite)

Implement exactly; add indexes where noted. All ids are `text` ULIDs generated in code. All timestamps are `integer` unix ms.

- `users` (id pk, clerk_user_id unique, email, created_at)
- `storefronts` (id pk, user_id fk, platform text check in ('shopify'), shop_domain unique, access_token_ref text, webhook_secret_ref text, created_at)
- `suppliers` (id pk, user_id fk, name, api_base_url, api_key_ref, email_sender_pattern text, parser_id text, active integer, created_at)
- `orders` (id pk, storefront_id fk, external_order_id text, external_order_number text, status text check in ('received','evaluating','fulfilling','partially_shipped','shipped','delivered','exception','rejected','cancelled'), currency, subtotal_cents integer, shipping_cents integer, margin_cents integer nullable, raw_payload_id fk->webhook_events, created_at, updated_at) — UNIQUE(storefront_id, external_order_id)
- `order_line_items` (id pk, order_id fk, external_line_item_id, fulfillment_order_line_item_id text nullable, sku, title, quantity integer, quantity_fulfilled integer default 0, unit_price_cents integer)
- `fulfillments` (id pk, order_id fk, supplier_id fk, cost_cents integer nullable, tracking_number text nullable, carrier_declared text nullable, carrier_detected text nullable, carrier_final text nullable, tracking_status text default 'pending', pushed_to_storefront integer default 0, source text check in ('regex','gemini','manual','supplier_api'), created_at, updated_at) — INDEX(tracking_number)
- `fulfillment_line_items` (id pk, fulfillment_id fk, order_line_item_id fk, quantity integer)
- `webhook_events` (id pk, source text check in ('shopify','17track','email'), dedup_key text, raw_body text, headers_json text, processed integer default 0, error text nullable, received_at) — UNIQUE(source, dedup_key)
- `disputes` (id pk, fulfillment_id fk, reason text, draft_subject text, draft_body text, status text check in ('draft','approved','sent','resolved','rejected'), created_at, updated_at)
- `settings` (user_id pk fk, min_margin_cents integer default 200, margin_mode text check in ('absolute','percent') default 'absolute', min_margin_percent real default 10, auto_fulfill integer default 1)

Seed script must produce a demo dataset that makes every dashboard page non-empty.

## 6. Ingestion paths (exact behavior)

### 6a. Shopify order webhook — `POST /webhooks/shopify`
1. Read raw body. Verify `X-Shopify-Hmac-Sha256` against the storefront's webhook secret (constant-time compare). 401 on failure.
2. Dedup: `dedup_key = X-Shopify-Webhook-Id` header. Insert into `webhook_events` with UNIQUE(source, dedup_key); on conflict return 200 immediately (already seen).
3. Insert `orders` row (status `received`) + `order_line_items` in one `db.batch()`. UNIQUE(storefront_id, external_order_id) conflict → return 200.
4. Enqueue `{orderId}` to the Queue. Return 200. Total handler logic must be trivially fast; nothing slow here.
5. Queue consumer starts one `OrderWorkflow` instance per order (instance id = order id, so duplicate deliveries can't spawn twins).

### 6b. Supplier email — Email Routing `email()` handler
1. Parse raw MIME with `postal-mime`. Store into `webhook_events` (source `email`, dedup_key = Message-ID).
2. Match sender against `suppliers.email_sender_pattern` to find supplier + `parser_id`.
3. Run the registered regex parser → `TrackingCandidate {trackingNumber, carrierDeclared?, externalOrderRef?, sku?}`.
4. If parser fails or confidence low → GeminiExtractor.extract(emailTextOrPdfBase64) with a strict responseSchema returning the same shape, plus `confidence`.
5. Validate: carrier detection chain (6c). On success → send `tracking-received` event to the matching OrderWorkflow instance. On failure → mark event with error, create a `disputes`-style review row? No — create nothing; set `webhook_events.error` and surface in dashboard "Needs review" list (query = email events with error, unprocessed).

### 6c. Carrier detection chain (in packages/core/src/carriers/detect.ts)
Priority: (1) `carrierDeclared` from parser/Gemini if it passes that carrier's format+checksum; (2) prefix/length detection: `1Z` + valid UPS mod-10 check digit → UPS; 20/22 digits starting 92/93/94/95 with valid USPS mod-10 → USPS-format (NOTE: may be FedEx SmartPost / UPS SurePost — mark ambiguous=true when no declared carrier); 12/15 digits → FedEx (format check only, no public checksum — weak); `JD`/DHL patterns → DHL; (3) ambiguous or checksum-fail → carrier_final stays null, fulfillment flagged `tracking_status='needs_review'`, and (when 17TRACK adapter active) registration with carrier auto-detect resolves it. Store carrier_declared, carrier_detected, carrier_final separately. Unit-test every validator with real-format positive AND negative cases (flip one digit → must fail).

## 7. OrderWorkflow (Cloudflare Workflows) — steps
1. `evaluate-margin`: fetch supplier price via SupplierClient adapter; margin = order subtotal − supplier cost − shipping (pure code, packages/core/margin.ts). Below user's threshold from `settings` → status `rejected`, notify dashboard, END.
2. `fetch-fulfillment-order`: Shopify GraphQL — get FulfillmentOrder + its line item ids, persist onto `order_line_items.fulfillment_order_line_item_id`.
3. `place-supplier-order`: SupplierClient.createOrder(); persist `fulfillments` shell row (no tracking yet); status `fulfilling`.
4. `await-tracking`: `step.waitForEvent('tracking-received', { timeout: '7 days' })`. Timeout → create dispute draft ("no tracking after 7 days") via DisputeWorkflow, status `exception`, wait again (up to 2 more cycles).
5. `push-fulfillment`: on event, write tracking to `fulfillments`, map covered SKUs → fulfillment_line_items, call Shopify `fulfillmentCreateV2` with ONLY those fulfillment-order line items. Update `quantity_fulfilled`.
6. `check-complete`: all line items fulfilled → status `shipped`; else `partially_shipped` and LOOP back to `await-tracking` for the next box.
7. `await-delivery`: waitForEvent `tracking-status` (from 17TRACK webhook) until delivered (→ `delivered`, END) or exception (→ DisputeWorkflow drafts carrier claim email via Gemini; human approves in dashboard; status `exception`).

## 8. Dashboard (React) — pages & requirements
- Login (Clerk; in mock mode a "Continue as dev user" button).
- Orders: table w/ status pills, margin column, filters, search; row → OrderDetail timeline (webhook received → margin → fulfillment(s) → tracking events), per-line-item fulfillment state, manual actions: approve rejected order, add tracking manually, cancel.
- Fulfillments: all tracking numbers, carrier_final, status; "Needs review" tab (ambiguous carrier / failed extraction) with one-click resolve (pick carrier, edit number — re-validates before save).
- Suppliers: CRUD, email sender pattern, parser picker, "test parser" box (paste an email, see extraction result live via API).
- Disputes: Gemini drafts w/ edit + Approve/Reject; approved → marked sent (real sending is a placeholder adapter).
- Settings: margin threshold + mode, auto-fulfill toggle, storefront + API key placeholder management.
- Metrics strip on Orders page: orders today, avg margin, % auto-extracted by regex vs gemini, exceptions open. Clean, dense, professional B2B UI; dark mode; no lorem ipsum — seed data everywhere.

## 9. API surface (Hono, `/api/*`, Clerk-authed)
`GET/POST /api/orders`, `GET /api/orders/:id`, `POST /api/orders/:id/approve|cancel|tracking`, `GET/PATCH /api/fulfillments`, `GET/POST/PATCH/DELETE /api/suppliers`, `POST /api/suppliers/:id/test-parser`, `GET/PATCH /api/disputes/:id`, `GET/PATCH /api/settings`, `GET /api/metrics`. Zod-validate every body. Consistent error envelope `{error: {code, message}}`.

## 10. Placeholder & mock convention
- `.dev.vars.example` lists every var: `SHOPIFY_ACCESS_TOKEN=PLACEHOLDER__SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET=...`, `GEMINI_API_KEY=...`, `SEVENTEENTRACK_API_KEY=...`, `CLERK_SECRET_KEY=...`, `CLERK_PUBLISHABLE_KEY=...`, plus `MOCK_MODE=true`.
- Every adapter exports `createX(env)`: returns mock impl when `env.MOCK_MODE === 'true'` OR its key starts with `PLACEHOLDER__`. Mocks are fixture-backed and deterministic (e.g., mock supplier "ships" 60s after order; mock Gemini returns fixtures/gemini responses).
- grep-able: every spot needing human follow-up is commented `// TODO(HUMAN): <exact instruction>` and listed in DEPLOY.md.

## 11. Testing requirements (minimum)
- core: margin math edge cases; every carrier validator (valid, single-digit-flipped invalid, wrong length, ambiguity 92-prefix case); each supplier parser against its email fixtures; malformed email falls through to Gemini path.
- worker (vitest-pool-workers): shopify webhook HMAC reject / accept / duplicate-delivery idempotency (same webhook id twice → one order, one workflow); email handler end-to-end against MIME fixture → fulfillment row with validated tracking; API auth guard.
- workflow: unit-test step functions with mocked step context (margin reject path, split-shipment loop: two tracking events fully fulfill a 3-item order).
- frontend: Orders table renders seed data; Needs-review resolve flow calls PATCH.
- `pnpm test` runs everything green; `pnpm build` produces the deployable worker with assets.

## 12. Milestones (commit after each)
1. Monorepo scaffold, tooling, CI script (`pnpm lint && pnpm typecheck && pnpm test && pnpm build`).
2. packages/core complete + tests (margin, carriers, parsers).
3. packages/db schema + migrations + seed.
4. Adapters with mocks + fixtures.
5. Worker: webhook + email + queue ingestion paths + tests.
6. Workflows (order + dispute) + tests.
7. API routes + auth.
8. Dashboard complete against seed data.
9. Polish: README (architecture diagram in mermaid), DEPLOY.md, STATUS.md, final green run.

## 13. Definition of Done (write to STATUS.md)
[ ] `pnpm i && pnpm test && pnpm build` green from clean clone
[ ] `pnpm dev` serves dashboard + API locally in MOCK_MODE with seeded D1; demo flow works: seed order → workflow → mock supplier ships → email fixture ingested → tracking validated → order shipped in UI
[ ] Zero LLM calls in pricing path (grep-proof), all external calls behind adapters
[ ] Every TODO(HUMAN) listed in DEPLOY.md with exact console URLs/steps (Cloudflare D1 create, Email Routing setup, Shopify app scopes `read_orders, write_fulfillments, read_fulfillments`, webhook registration, Clerk app, Gemini key, 17TRACK key)
[ ] `wrangler.toml` complete so that after filling secrets, deployment is exactly: `pnpm db:migrate:prod && wrangler deploy`

Begin at Milestone 1 now.
