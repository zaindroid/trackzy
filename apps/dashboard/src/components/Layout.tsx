import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { useTheme } from '../lib/theme.js';
import { apiFetch, type PendingSupplierOrder } from '../lib/api.js';

const NAV_ITEMS = [
  { to: '/opportunities', label: 'Opportunities' },
  { to: '/orders', label: 'Orders' },
  { to: '/approvals', label: 'Approvals', badge: true },
  { to: '/listings', label: 'Listings' },
  { to: '/fulfillments', label: 'Fulfillments' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/disputes', label: 'Disputes' },
  { to: '/connections', label: 'Connections' },
  { to: '/settings', label: 'Settings' },
];

function Wordmark() {
  return (
    <div className="font-display leading-none">
      <div className="text-xs font-medium tracking-[0.2em] text-ink-faint">FULFILLMENT</div>
      <div className="text-2xl font-semibold uppercase tracking-wide text-ink">Tracker</div>
    </div>
  );
}

function usePendingApprovalCount(): number {
  const { token } = useAuthToken();
  const query = useQuery({
    queryKey: ['pendingSupplierOrders'],
    queryFn: () => apiFetch<{ pendingSupplierOrders: PendingSupplierOrder[] }>('/pending-supplier-orders', token),
    refetchInterval: 30_000,
  });
  return query.data?.pendingSupplierOrders.filter((p) => p.status === 'pending').length ?? 0;
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pendingCount = usePendingApprovalCount();

  return (
    <nav className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center justify-between border-l-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'border-signal text-ink'
                : 'border-transparent text-ink-muted hover:border-rule hover:text-ink'
            }`
          }
        >
          <span>{item.label}</span>
          {item.badge && pendingCount > 0 && (
            <span className="rounded-sm bg-signal px-1.5 py-0.5 text-xs font-semibold text-signal-ink">{pendingCount}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="rounded-sm px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink"
    >
      {theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
    </button>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuthToken();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-rule px-4 py-3 lg:hidden">
        <Wordmark />
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="rounded-sm border border-rule px-3 py-2 text-sm text-ink"
        >
          Menu
        </button>
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]"
          />
          <div className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col gap-6 bg-paper-raised px-5 py-6 shadow-raised">
            <div className="flex items-center justify-between">
              <Wordmark />
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="rounded-sm px-2 py-1 text-sm text-ink-muted hover:text-ink"
              >
                Close
              </button>
            </div>
            <NavList onNavigate={() => setDrawerOpen(false)} />
            <div className="mt-auto flex flex-col gap-1 border-t border-rule pt-4">
              <ThemeToggle />
              <button
                onClick={logout}
                className="rounded-sm px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-[1400px]">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-8 border-r border-rule px-5 py-6 lg:flex">
          <Wordmark />
          <NavList />
          <div className="mt-auto flex flex-col gap-1 border-t border-rule pt-4">
            <ThemeToggle />
            <button
              onClick={logout}
              className="rounded-sm px-3 py-2 text-left text-sm text-ink-muted transition-colors hover:bg-paper hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
