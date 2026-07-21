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
