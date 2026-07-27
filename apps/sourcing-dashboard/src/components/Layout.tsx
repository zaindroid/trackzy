import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { useTheme } from '../lib/theme.js';
import { apiFetch, type CreditsResponse } from '../lib/api.js';

const LOW_BALANCE_THRESHOLD = 30;

function useAnimatedNumber(value: number): number {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  useEffect(() => {
    const from = displayRef.current;
    const to = value;
    if (from === to) return;
    const duration = 420;
    const start = performance.now();
    let raf = 0;
    function tick(now: number) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(from + (to - from) * eased);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(tick);
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

// Unified nav across both engines: discover (Zearch) → sell & fulfill (Zearch +
// trackzy) → account. One product to the user; two workers underneath.
const NAV_SECTIONS: { title: string; items: { to: string; label: string }[] }[] = [
  {
    title: 'Discover',
    items: [
      { to: '/', label: 'Overview' },
      { to: '/research', label: 'Research' },
      { to: '/radar', label: 'Radar' },
      { to: '/leaderboard', label: 'Leaderboard' },
      { to: '/library', label: 'Golden Products' },
    ],
  },
  {
    title: 'Sell & fulfill',
    items: [
      { to: '/orders', label: 'Orders' },
      { to: '/monitors', label: 'Price Monitor' },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/connections', label: 'Connections' },
      { to: '/billing', label: 'Billing' },
      { to: '/settings', label: 'Settings' },
    ],
  },
];

function Wordmark() {
  return (
    <div className="font-display leading-none">
      <div className="text-2xl font-semibold uppercase tracking-wide text-ink">Droparch</div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.title} className="flex flex-col gap-0.5">
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-ink-faint">{section.title}</div>
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-signal/10 text-ink' : 'text-ink-muted hover:bg-paper-raised hover:text-ink'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="rounded-lg px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink">
      {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuthToken();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col gap-6">
      <Wordmark />
      <CreditsCard />
      <NavList onNavigate={() => setDrawerOpen(false)} />
      <div className="mt-auto flex flex-col gap-1 border-t border-rule pt-4">
        <ThemeToggle />
        <button onClick={logout} className="rounded-lg px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink">
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-rule px-4 py-3 lg:hidden">
        <Wordmark />
        <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="rounded-lg border border-rule px-3 py-2 text-sm text-ink">
          Menu
        </button>
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button aria-label="Close menu" onClick={() => setDrawerOpen(false)} className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]" />
          <div className="absolute left-0 top-0 h-full w-72 max-w-[85vw] bg-paper-raised px-5 py-6 shadow-raised">{sidebar}</div>
        </div>
      )}

      <div className="lg:flex">
        <aside className="hidden w-60 shrink-0 border-r border-rule px-5 py-6 lg:block lg:min-h-screen">{sidebar}</aside>
        <main className="flex-1 px-4 py-6 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
