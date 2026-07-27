# Droparch visual redesign — design spec

## Context

The Zearch sourcing portal (`apps/sourcing-dashboard`) currently carries a distinctive but dated "trade manifest / freight editorial" visual identity: warm paper/ink colors, an uppercase condensed masthead wordmark (`Big Shoulders Display`), sharp corners, thin rule-line borders, left-border-accent nav. This redesign replaces that identity with a clean, minimal, professional look — explicitly modeled on trustworthy fintech/B2B platforms (Stripe, Mercury, Ramp, Linear) rather than a "GenZ floaty" aesthetic in the flashy/gradient/glassmorphism sense that was explored and rejected early in this brainstorm. "Floaty" here ended up meaning soft elevation and smooth, purposeful motion — not literal floating shapes, gradients, or glass.

The platform is also being renamed from "Zearch" to **Droparch**. This spec covers **Phase 1 only**: the visual redesign, including the display-name rebrand (wordmark, page titles, user-facing copy). A separate, later spec covers **Phase 2**: the full code/infra rename (folders, package names, wrangler config, new worker deploy under a new URL) — deliberately kept out of this phase because it's a materially riskier, unrelated migration that deserves its own sequencing and rollback plan.

## Goals

- Professional, minimal, trustworthy — not flashy, no emojis anywhere, no gimmicks.
- Preserve some of the current brand's warmth (paper/ink palette, condensed display font) rather than a wholesale identity replacement — evolve the *treatment*, keep the *character*.
- Fully responsive across screen sizes/aspect ratios — fluid grids, no fixed pixel layouts, applied consistently on every page.
- Every label, empty state, and error message reads like a finished professional product — no placeholder/lorem text, no leftover dev comments visible in the UI.
- Preserve and improve the existing "hidden asset / temptation" paywall pattern for free users (Golden Products library) — replace its current emoji-based lock treatment with something professional.
- Motion is purposeful and restrained: it indicates real state changes, never decoration for its own sake, never continuous/always-on effects on persistently-visible elements.

## Design tokens

**Color** (light mode; dark mode mirrors with existing darker values already in the codebase)

| Token | Value | Notes |
|---|---|---|
| `paper` | `#f8f6f1` | Unchanged — background |
| `paper-raised` | `#ffffff` | Unchanged — card/surface background |
| `ink` | `#1b1f26` | Unchanged — primary text |
| `ink-muted` / `ink-faint` | existing values | Unchanged — secondary/tertiary text |
| **accent** (new; replaces `signal` as primary action/link color) | `#4a7ba8` | "Moderate lighten" of the existing `freight` blue token (`#2f5d8a`) |
| accent-soft (chip/badge tint background) | `#eef4fa` | |
| border hairline | `#eee9dd` | Softer than the current `rule` token, matches the new minimal card treatment |
| `moss` / `ochre` / `brick` | existing values | Unchanged — semantic success/warning/danger states |
| Dark-mode accent | `#79ace0` | Reuses the **existing** dark-mode `freight` value as-is — already tuned for dark backgrounds, zero new token needed |

**Typography**

- `Big Shoulders Display` (uppercase condensed) is **kept**, scoped to: the wordmark ("DROPARCH"), page H1 titles (uppercase, unchanged from today's behavior — explicitly confirmed via visual comparison, NOT switching to sentence-case), and large hero/KPI numbers (credits balance, score, Home page stat tiles).
- `IBM Plex Sans` for everything else (body, nav, buttons, table text) — unchanged, no new font dependency.

**Shape/elevation**

- Card/panel corner radius: 14px (outer), 10–12px (nested elements)
- Button corner radius: 8px (not full pill)
- Shadow: `0 1px 3px rgba(0,0,0,0.04)` — quiet, not decorative
- Border: 1px hairline throughout, replacing the current heavier `border-rule` treatment

## Component patterns

**Navigation**: drops the current left-border-accent-bar treatment for the same hairline/shadow card language as the rest of the UI. Active nav item gets a soft accent-tinted background instead of a colored border.

**Credits display** (sidebar, top of nav, before any nav items — validated in detail via the visual companion):
- Own card, not a simple chip: solid `#4a7ba8` background chip labeled "CREDITS" (9px, bold, letter-spacing 0.05em, near-white `#f0f6fb` text) on its own row
- Balance number below in `Big Shoulders Display`, 28px, `ink` color, own row with clear spacing (not sharing a baseline with the label)
- "Top up →" link (12px, accent color) aligned to the number's row, right-aligned, bottom-edge-flush with the number (`align-items: flex-end`)
- Card padding: 12px outer wrapper, 12–14px inner card padding — compact, not airy
- **Animation**: count-up/count-down tween on value change only (420ms, strong ease-out `cubic-bezier(0.23,1,0.32,1)`, no bounce/spring — springs are reserved for gestural/decorative contexts, not appropriate for a balance number in a trustworthy platform). Low-balance state (balance below **30 credits**) fades the number color to a muted warning tone (`ochre` or `brick` token) over 220ms — a color fade, not a pulse/blink. Entrance on first mount: a barely-there 4px rise + fade, 180ms. **No continuous/always-on animation** — explicitly rejected; a persistently-visible element (seen on every page load) with constant decorative motion would both be distracting and imply false "live" activity the balance doesn't actually have, undermining the trustworthy-platform goal.

**Teaser/lock pattern** (Golden Products library, replaces the current 🔒 emoji overlay in `Library.tsx`):
- Full blur at rest (`backdrop-filter: blur(10px)`, no icon) with a small solid "PRO" label pill (dark background, white text) bottom-left of the image — no lock icon, no emoji
- On hover (desktop) or tap-and-hold (mobile): blur softens to a light haze (`blur(3px)`) as a "peek" — never a full reveal, never a static partial reveal. This preserves the existing code's explicit anti-reverse-image-search intent ("so the product can't be identified or reverse-searched at a glance") while still creating temptation
- Mobile has no hover equivalent by default; tap-and-hold is the accepted (slightly more work) parity fix rather than leaving mobile users with zero peek capability

## New page: Home / Overview

Currently `/` redirects straight to `/research` — there is no landing/overview page. This adds one:

1. Credits card (as specified above), top of page or reused from the persistent sidebar
2. Three responsive stat tiles: **Active listings** (count of `listingMonitors` with `stockStatus='in'`), **Needs attention** (count of `listingMonitors` where `health` is `'critical'`/`'paused'`, OR `suggestedSupplierProductId IS NOT NULL` — a pending one-click switch proposal), **Draft candidates** (count of `productCandidates` with `status='draft'`). Grid reflows 3-across (desktop) → 2-across with the third tile spanning full width (below ~640px)
3. Pending approvals surfaced prominently when present (e.g., a supplier-switch proposal awaiting review) — not buried in the Monitors page alone
4. Recent research results list — each row includes a small product thumbnail image (not text-only), niche name, and score

## Cross-cutting requirements

- **Thumbnails everywhere**: every result row across every page (Home, Research candidates, Radar, Leaderboard, Library) shows a product image thumbnail, not just text — this was inconsistent before (Home's initial wireframe was text-only until flagged).
- **Responsive throughout**: fluid grids, no fixed pixel widths, on every page — not just Home. Stat tiles, candidate cards, and list rows all reflow at their own breakpoints using the same underlying pattern.
- **Copy quality**: no placeholder/lorem text, no dev comments visible in the UI, anywhere — every empty state, error message, label, and button gets real, considered copy as part of this redesign, not deferred.
- **No emojis, anywhere**, replacing any that currently exist (confirmed: the `Library.tsx` lock emoji is the only one found so far; worth a final grep across the dashboard before considering this done).

## Rollout approach

**Approach A (selected)**: tokens → shared components → shell/nav → individual pages, each as its own commit, independently revertable. Rejected alternatives: one combined atomic commit (all-or-nothing risk, conflicts with the explicit ask to be able to "switch back easily"); a parallel v1/v2 component system with gradual cutover (more machinery than this change's risk profile warrants — git-commit-level granularity already provides the needed safety).

Suggested commit sequence:
1. Design tokens (`tailwind.config.js`, `index.css`) — new accent color, hairline border color, shadow value
2. Shared UI primitives (`components/ui.tsx`: Button, Panel, PageHeader, EmptyState, etc.)
3. Layout/nav shell (`components/Layout.tsx`) — wordmark → "Droparch", credits card, nav restyle
4. New Home/Overview page + route
5. Per-page restyle: Research, Monitors, Orders, Radar, Leaderboard, Library (teaser/lock fix included here), Connections, Billing, Settings — each its own commit
6. Final pass: grep for remaining emoji/placeholder text/old "Zearch" references in user-facing copy

## Explicitly out of scope (Phase 1)

- Any folder/package/deploy rename (`apps/sourcing-*` → `apps/droparch-*`, new worker URL, wrangler config, env vars, docs) — this is Phase 2, its own future spec, sequenced after Phase 1 ships and is validated.
- No changes to backend logic, API contracts, or data models — this is a visual/frontend-only pass.
