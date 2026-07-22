# Status — Definition of Done

Autonomous build session, milestones 1–9 complete. All items below were verified directly in this
sandbox (Node 20 installed user-local, pnpm via corepack — see DECISIONS.md "Environment").

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
