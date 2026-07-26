import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';
import { useTheme } from '../lib/theme.js';

const NAV_ITEMS = [
  { to: '/research', label: 'Research' },
  { to: '/connections', label: 'Connections' },
  { to: '/settings', label: 'Settings' },
];

function Wordmark() {
  return (
    <div className="font-display leading-none">
      <div className="text-xs font-medium tracking-[0.2em] text-ink-faint">ZEARCH</div>
      <div className="text-2xl font-semibold uppercase tracking-wide text-ink">Engine</div>
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center border-l-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? 'border-signal text-ink' : 'border-transparent text-ink-muted hover:border-rule hover:text-ink'
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="rounded-sm px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink">
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
      <NavList onNavigate={() => setDrawerOpen(false)} />
      <div className="mt-auto flex flex-col gap-1 border-t border-rule pt-4">
        <ThemeToggle />
        <button onClick={logout} className="rounded-sm px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink">
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="flex items-center justify-between border-b border-rule px-4 py-3 lg:hidden">
        <Wordmark />
        <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="rounded-sm border border-rule px-3 py-2 text-sm text-ink">
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
