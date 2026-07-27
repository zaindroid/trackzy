# Droparch Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `apps/sourcing-dashboard` from its current "trade manifest" look to a clean, minimal, professional identity (Stripe/Linear/Mercury-adjacent), rebrand the display name from "Zearch" to "Droparch", and add a new Home/Overview page — with zero folder/package/deploy changes (that's a separate future phase).

**Architecture:** Token-first cascade. Almost every card/border/shadow/color in this codebase already routes through Tailwind utility classes backed by CSS variables (`--color-signal`, `shadow-raised`, etc.) or the shared `components/ui.tsx` primitives (`Button`, `Panel`, `PageHeader`). Changing the token *values* first means most pages inherit the new look for free; remaining per-page work is narrow (corner radius on raw (non-`Panel`) card divs, three emoji removals, one new shared `Badge` component to de-duplicate a repeated inline pill pattern found in 5 files, and one new page).

**Tech Stack:** React 18, Tailwind CSS (JIT, CSS-variable-backed theme), TanStack Query, Vite, Vitest.

## Global Constraints

- No emojis anywhere in the UI (spec: "never use emojis").
- No placeholder/lorem text or dev comments visible in the UI — every label/empty-state/error string must be real, considered copy.
- Every layout must be fluid/responsive — no fixed pixel widths, consistent grid-reflow pattern across pages.
- This phase (Phase 1) changes display text and styling only. Do not rename folders, packages, `wrangler.sourcing.toml`, or touch deploy config — that's Phase 2, a separate future plan.
- Each task below is its own commit, independently revertable (per explicit user request).
- Run `pnpm --filter @sourcing/dashboard run typecheck` and `pnpm --filter @sourcing/dashboard test` at the end of every task before committing.

---

## Task 1: Design tokens

**Files:**
- Modify: `apps/sourcing-dashboard/src/index.css:6-37`
- Modify: `apps/sourcing-dashboard/tailwind.config.js`

**Interfaces:**
- Produces: `--color-signal` now resolves to the new accent blue (light: `74 123 168`, dark: `121 172 217` — reused from the existing dark-mode `--color-freight` value). `--color-rule` resolves to a softer hairline (light: `238 233 221`). `shadow-raised` utility resolves to the new quiet shadow. New `keyframes.creditsEnter` / `animation.creditsEnter` available for Task 3.
- Consumes: nothing (base layer).

- [ ] **Step 1: Update the color CSS variables**

In `apps/sourcing-dashboard/src/index.css`, in the `:root` block, change:

```css
  --color-rule: 227 221 208;
  --color-signal: 184 81 30;
```

to:

```css
  --color-rule: 238 233 221;
  --color-signal: 74 123 168;
```

In the `.dark` block, change:

```css
  --color-rule: 43 46 54;
  --color-signal: 224 122 66;
```

to:

```css
  --color-rule: 43 46 54;
  --color-signal: 121 172 217;
```

(`--color-signal-ink` stays unchanged in both modes — white-on-blue in light mode and dark-text-on-light-blue in dark mode both retain sufficient contrast with the new hue.)

- [ ] **Step 2: Update the shadow token and add the credits-card entrance keyframe**

In `apps/sourcing-dashboard/tailwind.config.js`, change:

```js
      boxShadow: {
        raised: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.03)',
      },
```

to:

```js
      boxShadow: {
        raised: '0 1px 3px rgb(0 0 0 / 0.04)',
      },
      keyframes: {
        creditsEnter: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        creditsEnter: 'creditsEnter 180ms cubic-bezier(0.23,1,0.32,1)',
      },
```

- [ ] **Step 3: Verify nothing broke**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS (this step only changes CSS/config values, no component code — existing tests assert behavior/text, not color values, so they should be unaffected)

- [ ] **Step 4: Visually spot-check**

Run: `pnpm --filter @sourcing/dashboard run dev`, open the app, confirm buttons/active-nav/links are now blue instead of orange, and card shadows look quieter. Stop the dev server after checking.

- [ ] **Step 5: Commit**

```bash
git add apps/sourcing-dashboard/src/index.css apps/sourcing-dashboard/tailwind.config.js
git commit -m "style(droparch): swap accent to blue, soften shadow and hairline tokens"
```

---

## Task 2: Shared UI primitives — radius, new Badge component

**Files:**
- Modify: `apps/sourcing-dashboard/src/components/ui.tsx`

**Interfaces:**
- Produces: `Badge({ tone?: 'moss'|'ochre'|'brick'|'signal'|'neutral', className?: string, children: ReactNode })` — new export. `Button`, `Panel`, `PageHeader` unchanged in signature, only their internal className strings change.
- Consumes: nothing new.

- [ ] **Step 1: Update Button, Panel radius**

In `apps/sourcing-dashboard/src/components/ui.tsx`, change the `Button` className (line 17) from:

```tsx
      className={`inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${VARIANTS[variant]} ${className}`}
```

to:

```tsx
      className={`inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium transition-all active:scale-[0.97] ${VARIANTS[variant]} ${className}`}
```

(`transition-colors` → `transition-all` plus `active:scale-[0.97]` gives every button in the app the press-feedback micro-interaction — a direct, low-risk application of the same "buttons must feel responsive" principle already used for the credits card's Top-up link in Task 3.)

Change `FIELD_CLASSES` (line 24) from:

```tsx
  'w-full rounded-sm border border-rule bg-paper-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint disabled:opacity-50';
```

to:

```tsx
  'w-full rounded-lg border border-rule bg-paper-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint disabled:opacity-50';
```

Change `Panel`'s className (line 58) from:

```tsx
    <section className={`rounded-sm border border-rule bg-paper-raised p-4 shadow-raised sm:p-5 ${className}`}>
```

to:

```tsx
    <section className={`rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised sm:p-5 ${className}`}>
```

- [ ] **Step 2: Add the Badge component**

Add this new export to the end of `apps/sourcing-dashboard/src/components/ui.tsx`:

```tsx
const BADGE_TONES = {
  moss: 'bg-moss/15 text-moss',
  ochre: 'bg-ochre/20 text-ochre',
  brick: 'bg-brick/15 text-brick',
  signal: 'bg-signal/15 text-signal',
  neutral: 'bg-paper text-ink-faint',
};

export function Badge({
  tone = 'neutral',
  className = '',
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/sourcing-dashboard/src/components/ui.tsx
git commit -m "style(droparch): update shared UI primitives, add Badge component"
```

---

## Task 3: Shell, nav, credits card, wordmark rename

**Files:**
- Modify: `apps/sourcing-dashboard/src/components/Layout.tsx`

**Interfaces:**
- Produces: `CreditsCard()` component (replaces `CreditChip`), rendered at the top of the sidebar before nav.
- Consumes: `apiFetch`, `CreditsResponse` from `../lib/api.js` (already imported), `useAuthToken` from `../lib/auth.js` (already imported).

- [ ] **Step 1: Replace CreditChip with the animated CreditsCard**

In `apps/sourcing-dashboard/src/components/Layout.tsx`, replace the entire `CreditChip` function (lines 8-17) with:

```tsx
const LOW_BALANCE_THRESHOLD = 30;

function useAnimatedNumber(value: number): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const duration = 420;
    const start = performance.now();
    let raf = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return display;
}

function CreditsCard() {
  const { getToken } = useAuthToken();
  const { data } = useQuery({ queryKey: ['credits'], queryFn: () => apiFetch<CreditsResponse>('/credits', getToken) });
  const balance = data?.balance ?? 0;
  const displayed = useAnimatedNumber(balance);
  const low = displayed < LOW_BALANCE_THRESHOLD;
  return (
    <div className="animate-creditsEnter rounded-xl border border-rule bg-paper-raised p-3">
      <span className="inline-block rounded-md bg-signal px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-signal-ink">Credits</span>
      <div className={`mt-1.5 font-display text-[28px] font-extrabold leading-none transition-colors duration-[220ms] ${low ? 'text-brick' : 'text-ink'}`}>
        {displayed}
      </div>
      <div className="mt-1.5 flex justify-end">
        <NavLink to="/billing" className="text-xs font-semibold text-signal transition-transform active:scale-95">
          Top up →
        </NavLink>
      </div>
    </div>
  );
}
```

Add `useEffect, useRef` to the existing `useState` import at the top of the file — change:

```tsx
import { useState, type ReactNode } from 'react';
```

to:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
```

- [ ] **Step 2: Use CreditsCard in the sidebar, before nav**

Find this line in the `sidebar` JSX (inside `Layout`):

```tsx
      <Wordmark />
      <CreditChip />
      <NavList onNavigate={() => setDrawerOpen(false)} />
```

Change to:

```tsx
      <Wordmark />
      <CreditsCard />
      <NavList onNavigate={() => setDrawerOpen(false)} />
```

- [ ] **Step 3: Rename the wordmark**

Change the `Wordmark` function from:

```tsx
function Wordmark() {
  return (
    <div className="font-display leading-none">
      <div className="text-xs font-medium tracking-[0.2em] text-ink-faint">ZEARCH</div>
      <div className="text-2xl font-semibold uppercase tracking-wide text-ink">Engine</div>
    </div>
  );
}
```

to:

```tsx
function Wordmark() {
  return (
    <div className="font-display leading-none">
      <div className="text-2xl font-semibold uppercase tracking-wide text-ink">Droparch</div>
    </div>
  );
}
```

(Collapsing to a single line: "ZEARCH / Engine" was a two-part construction; "Droparch" is a single name and doesn't need the eyebrow-plus-title split.)

- [ ] **Step 4: Restyle nav — hairline/shadow card language instead of left-border-accent**

Change the `NavList` function's per-item className from:

```tsx
              className={({ isActive }) =>
                `flex items-center border-l-2 px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'border-signal text-ink' : 'border-transparent text-ink-muted hover:border-rule hover:text-ink'
                }`
              }
```

to:

```tsx
              className={({ isActive }) =>
                `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-signal/10 text-ink' : 'text-ink-muted hover:bg-paper-raised hover:text-ink'
                }`
              }
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

Run: `pnpm --filter @sourcing/dashboard run dev`, open the app, confirm the sidebar shows "Droparch", the credits card sits above nav with the blue "CREDITS" chip, and clicking between nav items shows the new soft-background active state instead of a left border. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add apps/sourcing-dashboard/src/components/Layout.tsx
git commit -m "feat(droparch): rename wordmark, animated credits card, restyle nav"
```

---

## Task 4: New Home / Overview page

**Files:**
- Create: `apps/sourcing-dashboard/src/pages/Home.tsx`
- Modify: `apps/sourcing-dashboard/src/App.tsx`
- Modify: `apps/sourcing-dashboard/src/components/Layout.tsx` (add nav entry)

**Interfaces:**
- Produces: `HomePage()` component, exported, mounted at route `/`.
- Consumes: `apiFetch` (`../lib/api.js`), `useAuthToken` (`../lib/auth.js`), `Badge`/`PageHeader`/`EmptyState` (`../components/ui.js`), existing API types `ListingMonitor`, `ProductCandidate` (`../lib/api.js`).

- [ ] **Step 1: Write the Home page**

Create `apps/sourcing-dashboard/src/pages/Home.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ListingMonitor, type ProductCandidate } from '../lib/api.js';
import { Badge, PageHeader } from '../components/ui.js';

function StatTile({ label, value, tone = 'ink' }: { label: string; value: number; tone?: 'ink' | 'brick' }) {
  return (
    <div className="rounded-xl border border-rule bg-paper-raised p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-1 font-display text-[28px] font-extrabold leading-none ${tone === 'brick' ? 'text-brick' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

function ResultRow({ imageUrl, title, score }: { imageUrl?: string | null; title: string; score: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-rule bg-paper-raised p-2.5">
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-rule bg-paper">
        {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{title}</span>
      <span className="shrink-0 text-sm font-semibold text-signal">{Math.round(score)}</span>
    </div>
  );
}

export function HomePage() {
  const { getToken } = useAuthToken();

  const monitorsQuery = useQuery({
    queryKey: ['monitors'],
    queryFn: () => apiFetch<{ monitors: ListingMonitor[] }>('/monitor', getToken),
  });
  const candidatesQuery = useQuery({
    queryKey: ['candidates'],
    queryFn: () => apiFetch<{ candidates: ProductCandidate[] }>('/product-research', getToken),
  });

  const monitors = monitorsQuery.data?.monitors ?? [];
  const candidates = candidatesQuery.data?.candidates ?? [];

  const activeListings = monitors.filter((m) => m.stockStatus === 'in').length;
  const needsAttention = monitors.filter((m) => m.health === 'critical' || m.health === 'paused' || m.pendingSwitch != null);
  const draftCandidates = candidates.filter((c) => c.status === 'draft');
  const recent = [...candidates].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 5);

  const pendingSwitch = monitors.find((m) => m.pendingSwitch != null);

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Droparch" title="Overview" description="Everything that needs your attention, at a glance." />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Active listings" value={activeListings} />
        <StatTile label="Needs attention" value={needsAttention.length} tone={needsAttention.length > 0 ? 'brick' : 'ink'} />
        <StatTile label="Draft candidates" value={draftCandidates.length} />
      </div>

      {pendingSwitch && pendingSwitch.pendingSwitch && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-ochre/40 bg-ochre/5 p-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Supplier switch awaiting approval</p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">"{pendingSwitch.title}" went out of stock — a replacement was found</p>
          </div>
          <NavLink to="/monitors">
            <Badge tone="ochre" className="shrink-0 cursor-pointer px-3 py-1.5 text-xs">
              Review
            </Badge>
          </NavLink>
        </div>
      )}

      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Recent research</div>
      {recent.length === 0 ? (
        <p className="rounded-xl border border-rule bg-paper-raised px-4 py-6 text-center text-sm text-ink-faint">
          No research yet — head to Product research to find your first winners.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((c) => (
            <ResultRow key={c.id} imageUrl={c.supplierImageUrls[0]} title={c.generatedTitle} score={c.opportunityScore} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount the route**

In `apps/sourcing-dashboard/src/App.tsx`, add the import:

```tsx
import { HomePage } from './pages/Home.js';
```

Change:

```tsx
        <Route path="/" element={<Navigate to="/research" replace />} />
```

to:

```tsx
        <Route path="/" element={<HomePage />} />
```

- [ ] **Step 3: Add "Overview" to the nav**

In `apps/sourcing-dashboard/src/components/Layout.tsx`, add an entry to `NAV_SECTIONS` — change the `Discover` section from:

```tsx
  {
    title: 'Discover',
    items: [
      { to: '/research', label: 'Research' },
```

to:

```tsx
  {
    title: 'Discover',
    items: [
      { to: '/', label: 'Overview' },
      { to: '/research', label: 'Research' },
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

Run: `pnpm --filter @sourcing/dashboard run dev`, log in, confirm you land on `/` and see the Overview page with real stat tiles. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Home.tsx apps/sourcing-dashboard/src/App.tsx apps/sourcing-dashboard/src/components/Layout.tsx
git commit -m "feat(droparch): add Home/Overview page as the new landing route"
```

---

## Task 5: Library.tsx — teaser/lock pattern rework

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Library.tsx`

**Interfaces:**
- Consumes: `Badge` (new, from Task 2).
- No exported interface changes — `Thumb`/`WinnerCard`/`LibraryPage` signatures unchanged.

- [ ] **Step 1: Replace the emoji lock with the hover-peek pattern**

In `apps/sourcing-dashboard/src/pages/Library.tsx`, replace the `Thumb` function entirely:

```tsx
function Thumb({ src, blurred, alt }: { src: string | null; blurred: boolean; alt: string }) {
  if (!src) return <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-[9px] text-ink-faint">Locked</div>;
  return (
    <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-rule">
      {/* Full blur at rest so the product can't be identified or reverse-searched;
          softens to a light haze on hover/tap-hold as a "peek" — never a full reveal. */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover transition-[filter] duration-200"
        style={blurred ? { filter: 'blur(10px)', transform: 'scale(1.3)' } : undefined}
      />
      {blurred && (
        <>
          <img
            src={src}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-[1.3] object-cover opacity-0 blur-[3px] transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100"
          />
          <span className="absolute bottom-1 left-1 rounded-md bg-ink px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-paper">Pro</span>
        </>
      )}
    </div>
  );
}
```

(Two stacked `<img>`s: the base one stays at the strong 10px blur always; a second copy at 3px blur fades in on `:hover`/`:active` via `group-hover`/`group-active` — this means the "peek" is a pure-CSS opacity crossfade, no JS needed, and `group-active` gives the same effect on tap-and-hold for touch devices for free since `:active` fires on touch-hold in all mobile browsers.)

- [ ] **Step 2: Update card radius and swap the score badge to use the shared Badge**

In the same file, change `WinnerCard`'s outer div from:

```tsx
    <div className="border border-rule bg-paper-raised p-4 shadow-raised">
```

to:

```tsx
    <div className="rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised">
```

Change:

```tsx
            <span className="shrink-0 rounded-sm bg-ochre/20 px-2 py-0.5 text-xs font-semibold text-ochre">score {Math.round(w.score)}</span>
```

to:

```tsx
            <Badge tone="ochre" className="shrink-0">score {Math.round(w.score)}</Badge>
```

Add `Badge` to the existing import — change:

```tsx
import { Button, EmptyState, PageHeader, Panel } from '../components/ui.js';
```

to:

```tsx
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui.js';
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

Run: `pnpm --filter @sourcing/dashboard run dev`, open Golden Products as a Pro test user, confirm locked thumbnails show no emoji, hovering softens the blur briefly without ever fully revealing the image. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Library.tsx
git commit -m "fix(droparch): replace emoji lock with hover-peek blur teaser"
```

---

## Task 6: Leaderboard.tsx — remove medal emoji, radius fixes

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Leaderboard.tsx`

**Interfaces:**
- Consumes: `Badge` (from Task 2).

- [ ] **Step 1: Replace medal emoji with a colored rank badge**

In `apps/sourcing-dashboard/src/pages/Leaderboard.tsx`, change:

```tsx
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
          return (
            <div key={w.id} className="flex items-center gap-3 rounded-md border border-rule bg-paper-raised p-2.5">
              <span className="w-7 shrink-0 text-center font-display text-lg font-bold tabular-nums text-ink-faint">{medal ?? i + 1}</span>
```

to:

```tsx
          const topThree = i < 3;
          return (
            <div key={w.id} className="flex items-center gap-3 rounded-xl border border-rule bg-paper-raised p-2.5">
              <span
                className={`flex w-7 shrink-0 items-center justify-center rounded-md text-center font-display text-sm font-bold tabular-nums ${
                  topThree ? `${RANK_COLORS[i]} text-paper` : 'text-ink-faint'
                }`}
              >
                {i + 1}
              </span>
```

(Reuses the existing `RANK_COLORS` array — `bg-signal`/`bg-moss`/`bg-ochre` — that already colors the progress bar for the top 3, now also coloring the rank number's background. No new color introduced, no emoji.)

- [ ] **Step 2: Radius + Badge for the "New" pill**

Change:

```tsx
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-rule bg-paper">
```

to:

```tsx
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-rule bg-paper">
```

Change:

```tsx
                  {w.isNew && <span className="shrink-0 rounded-sm bg-moss/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-moss">New</span>}
```

to:

```tsx
                  {w.isNew && <Badge tone="moss" className="shrink-0 text-[10px]">New</Badge>}
```

Add `Badge` to the import — change:

```tsx
import { EmptyState, PageHeader } from '../components/ui.js';
```

to:

```tsx
import { Badge, EmptyState, PageHeader } from '../components/ui.js';
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Leaderboard.tsx
git commit -m "fix(droparch): replace medal emoji with colored rank badge"
```

---

## Task 7: Research.tsx — close icon, radius fixes

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Research.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Replace the ✕ close glyph with an inline SVG icon**

Change:

```tsx
          <button type="button" className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
```

to:

```tsx
          <button type="button" className="text-ink-muted transition-colors hover:text-ink" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
```

- [ ] **Step 2: Radius on card wrappers and thumbnails**

Change (`ReviewModal`'s outer card):

```tsx
      <div className="w-full max-w-2xl border border-rule bg-paper-raised shadow-raised" onClick={(e) => e.stopPropagation()}>
```

to:

```tsx
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-rule bg-paper-raised shadow-raised" onClick={(e) => e.stopPropagation()}>
```

Change the `Thumb` function's two className strings — from:

```tsx
      <div style={style} className="flex shrink-0 items-center justify-center border border-rule bg-paper text-[9px] text-ink-faint">
```

to:

```tsx
      <div style={style} className="flex shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-[9px] text-ink-faint">
```

and from:

```tsx
  return <img src={src} alt={alt} style={style} className="shrink-0 border border-rule object-cover" />;
```

to:

```tsx
  return <img src={src} alt={alt} style={style} className="shrink-0 rounded-lg border border-rule object-cover" />;
```

Change the price-breakdown mini-panels (two occurrences — in `ReviewModal` and `CandidateCard`) from:

```tsx
          <div className="mt-3 rounded-sm bg-paper p-2 text-xs text-ink-muted">
```

to:

```tsx
          <div className="mt-3 rounded-lg bg-paper p-2.5 text-xs text-ink-muted">
```

and from:

```tsx
          <div className="mt-2 rounded-sm bg-paper p-2 text-xs text-ink-muted">
```

to:

```tsx
          <div className="mt-2 rounded-lg bg-paper p-2.5 text-xs text-ink-muted">
```

Change `CandidateCard`'s outer div and the search-form card wrapper — from:

```tsx
    <div className="border border-rule bg-paper-raised p-4 shadow-raised">
```

to:

```tsx
    <div className="rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised">
```

and from:

```tsx
      <div className="mb-6 border border-rule bg-paper-raised p-4 shadow-raised">
```

to:

```tsx
      <div className="mb-6 rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised">
```

Change `ResearchProgress`'s wrapper from:

```tsx
    <div className="mt-3 flex items-center gap-3 rounded-sm bg-paper p-3">
```

to:

```tsx
    <div className="mt-3 flex items-center gap-3 rounded-xl bg-paper p-3">
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS — `Research.test.tsx` already exists; confirm it still passes (it should, since none of these changes touch queried text/roles, only className/markup for an icon).

- [ ] **Step 4: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Research.tsx
git commit -m "style(droparch): SVG close icon, card/thumbnail radius updates"
```

---

## Task 8: Monitors.tsx — Badge adoption, radius fixes

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Monitors.tsx`

**Interfaces:**
- Consumes: `Badge` (from Task 2).

- [ ] **Step 1: Replace the health pill with Badge**

Change:

```tsx
const HEALTH_TONE: Record<ListingMonitor['health'], string> = {
  healthy: 'bg-moss/15 text-moss',
  warning: 'bg-ochre/20 text-ochre',
  critical: 'bg-brick/15 text-brick',
  paused: 'bg-paper text-ink-faint',
};
```

to:

```tsx
const HEALTH_TONE: Record<ListingMonitor['health'], 'moss' | 'ochre' | 'brick' | 'neutral'> = {
  healthy: 'moss',
  warning: 'ochre',
  critical: 'brick',
  paused: 'neutral',
};
```

Change:

```tsx
            <span className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold capitalize ${HEALTH_TONE[m.health]}`}>{m.health}</span>
```

to:

```tsx
            <Badge tone={HEALTH_TONE[m.health]} className="shrink-0">{m.health}</Badge>
```

Add `Badge` to the import — change:

```tsx
import { Button, EmptyState, PageHeader, TextInput } from '../components/ui.js';
```

to:

```tsx
import { Badge, Button, EmptyState, PageHeader, TextInput } from '../components/ui.js';
```

- [ ] **Step 2: Radius on card wrappers and images**

Change the `MonitorCard` outer div from:

```tsx
    <div className="border border-rule bg-paper-raised p-4 shadow-raised">
```

to:

```tsx
    <div className="rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised">
```

Change the listing thumbnail from:

```tsx
        {m.imageUrl && <img src={m.imageUrl} alt={m.title} className="h-14 w-14 shrink-0 border border-rule object-cover" />}
```

to:

```tsx
        {m.imageUrl && <img src={m.imageUrl} alt={m.title} className="h-14 w-14 shrink-0 rounded-lg border border-rule object-cover" />}
```

Change the pending-switch panel and its thumbnail — from:

```tsx
            <div className="mt-3 border border-ochre/40 bg-ochre/5 p-3">
```

to:

```tsx
            <div className="mt-3 rounded-xl border border-ochre/40 bg-ochre/5 p-3">
```

and from:

```tsx
                  <img src={m.pendingSwitch.imageUrl} alt={m.pendingSwitch.title ?? 'candidate'} className="h-16 w-16 shrink-0 border border-rule object-cover" />
```

to:

```tsx
                  <img src={m.pendingSwitch.imageUrl} alt={m.pendingSwitch.title ?? 'candidate'} className="h-16 w-16 shrink-0 rounded-lg border border-rule object-cover" />
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Monitors.tsx
git commit -m "style(droparch): Badge adoption and radius updates on Monitors"
```

---

## Task 9: Orders.tsx — Badge adoption, radius fixes

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Orders.tsx`

**Interfaces:**
- Consumes: `Badge` (from Task 2).

- [ ] **Step 1: Replace the status pill with Badge**

Change:

```tsx
const STATUS_TONE: Record<string, string> = {
  received: 'bg-signal/15 text-signal',
  fulfilled: 'bg-moss/15 text-moss',
  shipped: 'bg-moss/15 text-moss',
  cancelled: 'bg-brick/15 text-brick',
  error: 'bg-brick/15 text-brick',
};
```

to:

```tsx
const STATUS_TONE: Record<string, 'signal' | 'moss' | 'brick'> = {
  received: 'signal',
  fulfilled: 'moss',
  shipped: 'moss',
  cancelled: 'brick',
  error: 'brick',
};
```

Change:

```tsx
                    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_TONE[o.status] ?? 'bg-paper text-ink-muted'}`}>{o.status}</span>
```

to:

```tsx
                    <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{o.status}</Badge>
```

Add `Badge` to the import — change:

```tsx
import { EmptyState, PageHeader } from '../components/ui.js';
```

to:

```tsx
import { Badge, EmptyState, PageHeader } from '../components/ui.js';
```

- [ ] **Step 2: Radius on the table wrapper**

Change:

```tsx
        <div className="overflow-x-auto border border-rule">
```

to:

```tsx
        <div className="overflow-x-auto rounded-2xl border border-rule shadow-raised">
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Orders.tsx
git commit -m "style(droparch): Badge adoption and radius updates on Orders"
```

---

## Task 10: Connections.tsx — Badge adoption

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Connections.tsx`

**Interfaces:**
- Consumes: `Badge` (from Task 2).

- [ ] **Step 1: Replace the three status pills with Badge**

Change all three occurrences of:

```tsx
              <span className="rounded-sm bg-moss/15 px-2 py-0.5 text-xs font-medium text-moss">Connected</span>
```

to:

```tsx
              <Badge tone="moss">Connected</Badge>
```

(this exact string appears twice — the eBay panel and the CJ panel — replace both), and:

```tsx
          <span className="rounded-sm bg-moss/15 px-2 py-0.5 text-xs font-medium text-moss">Ready</span>
```

to:

```tsx
          <Badge tone="moss">Ready</Badge>
```

Add `Badge` to the import — change:

```tsx
import { Button, PageHeader, Panel, TextInput } from '../components/ui.js';
```

to:

```tsx
import { Badge, Button, PageHeader, Panel, TextInput } from '../components/ui.js';
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Connections.tsx
git commit -m "style(droparch): Badge adoption on Connections"
```

---

## Task 11: Radar.tsx — radius fixes

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Radar.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Radius on the filter bar, table wrapper, and thumbnails**

Change:

```tsx
      <div className="mb-4 flex flex-wrap items-center gap-3 border border-rule bg-paper-raised p-3 shadow-raised">
```

to:

```tsx
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-rule bg-paper-raised p-3 shadow-raised">
```

Change:

```tsx
        <div className="overflow-x-auto border border-rule">
```

to:

```tsx
        <div className="overflow-x-auto rounded-2xl border border-rule shadow-raised">
```

Change the `Thumb` function's two className strings — from:

```tsx
    return <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-rule bg-paper text-[8px] text-ink-faint">No image</div>;
```

to:

```tsx
    return <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-[8px] text-ink-faint">No image</div>;
```

and from:

```tsx
  return <img src={src} alt={alt} className="h-12 w-12 shrink-0 border border-rule object-cover" />;
```

to:

```tsx
  return <img src={src} alt={alt} className="h-12 w-12 shrink-0 rounded-lg border border-rule object-cover" />;
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS — `Radar.test.tsx` already exists; confirm it still passes.

- [ ] **Step 3: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Radar.tsx
git commit -m "style(droparch): radius updates on Radar"
```

---

## Task 12: Billing.tsx — radius fix, hero-number balance display

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Billing.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Radius on offering cards**

Change:

```tsx
            <div key={o.id} className="flex flex-col items-start gap-1 border border-rule p-4">
```

to:

```tsx
            <div key={o.id} className="flex flex-col items-start gap-1 rounded-xl border border-rule p-4">
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

(The balance number already uses `font-display text-4xl` inside `Panel` — this already matches the "hero number" treatment from the design tokens spec with no further change needed.)

- [ ] **Step 3: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Billing.tsx
git commit -m "style(droparch): radius update on Billing offering cards"
```

---

## Task 13: Login.tsx — wordmark rename, radius fix

**Files:**
- Modify: `apps/sourcing-dashboard/src/pages/Login.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Rename the wordmark and add card radius**

Change:

```tsx
      <div className="w-full max-w-sm border border-rule bg-paper-raised p-8 shadow-raised">
        <div className="mb-8 border-b border-dashed border-rule pb-6 text-center">
          <div className="text-xs font-medium tracking-[0.2em] text-ink-faint">ZEARCH</div>
          <div className="font-display text-3xl font-semibold uppercase tracking-wide text-ink">Engine</div>
          <p className="mt-2 text-sm text-ink-muted">Find winning products, list them in one click</p>
        </div>
```

to:

```tsx
      <div className="w-full max-w-sm rounded-2xl border border-rule bg-paper-raised p-8 shadow-raised">
        <div className="mb-8 border-b border-dashed border-rule pb-6 text-center">
          <div className="font-display text-3xl font-semibold uppercase tracking-wide text-ink">Droparch</div>
          <p className="mt-2 text-sm text-ink-muted">Find winning products, list them in one click</p>
        </div>
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @sourcing/dashboard run typecheck && pnpm --filter @sourcing/dashboard test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/sourcing-dashboard/src/pages/Login.tsx
git commit -m "style(droparch): rename wordmark on Login, add card radius"
```

---

## Task 14: Final verification pass

**Files:** none modified — verification only, unless the greps below turn up something unexpected (in which case fix inline before committing).

**Interfaces:** none.

- [ ] **Step 1: Confirm Settings.tsx needs no changes**

`apps/sourcing-dashboard/src/pages/Settings.tsx` uses only `Panel`/`Field`/`Select`/`TextInput`/`Button` — no raw styling — so it inherits every token/component change automatically. Open it in the running dev server and confirm it looks consistent with the rest of the app. No commit needed for this step.

- [ ] **Step 2: Grep for remaining emoji across the whole dashboard**

Run:

```bash
grep -rnP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' apps/sourcing-dashboard/src --include='*.tsx'
```

Expected: no output (Library.tsx's lock, Leaderboard.tsx's medals, and Research.tsx's ✕ were the only three found during planning — Tasks 5, 6, 7 already removed them). If anything else turns up, replace it with plain text or an inline SVG icon following the same pattern used in those tasks, matching this plan's "no emoji" constraint.

- [ ] **Step 3: Grep for leftover "Zearch" references in user-facing strings**

Run:

```bash
grep -rn "Zearch\|ZEARCH" apps/sourcing-dashboard/src
```

Expected: no output (Layout.tsx's wordmark and Login.tsx's wordmark were the two found during planning — Tasks 3 and 13 already renamed them). Note: this grep is scoped to `apps/sourcing-dashboard/src` only — per this plan's Global Constraints, folder names, package names, and any "Zearch" references in `apps/sourcing-worker` or deploy config are explicitly Phase 2 and out of scope here.

- [ ] **Step 4: Grep for leftover rounded-sm usage outside ui.tsx**

Run:

```bash
grep -rln "rounded-sm" apps/sourcing-dashboard/src/pages apps/sourcing-dashboard/src/components
```

Expected: no output — Tasks 2, 5, 6, 7, 8, 9 replaced every instance found during planning. If anything remains, bump it to `rounded-lg` (small elements) or `rounded-2xl` (card containers) to match the rest of the redesign.

- [ ] **Step 5: Full build**

Run: `pnpm --filter @sourcing/dashboard run build`
Expected: PASS with no errors.

- [ ] **Step 6: Final manual pass**

Run: `pnpm --filter @sourcing/dashboard run dev`, click through every page in the nav (Overview, Research, Radar, Leaderboard, Golden Products, Orders, Price Monitor, Connections, Billing, Settings) and confirm: consistent blue accent throughout, no sharp/inconsistent corners, no emoji anywhere, credits card visible and correct in the sidebar on every page. Stop the dev server.

- [ ] **Step 7: Commit (only if Steps 2-4 found and fixed anything)**

```bash
git add -A
git commit -m "fix(droparch): final cleanup — stray emoji/rounded-sm/Zearch references"
```

If Steps 2-4 found nothing, skip this commit — the plan is complete as of Task 13.
