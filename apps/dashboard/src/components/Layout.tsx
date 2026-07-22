import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';

const NAV_ITEMS = [
  { to: '/orders', label: 'Orders' },
  { to: '/fulfillments', label: 'Fulfillments' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/disputes', label: 'Disputes' },
  { to: '/settings', label: 'Settings' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuthToken();

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900/60 px-4 py-6">
        <div className="mb-8 px-2 text-lg font-semibold tracking-tight">
          Fulfillment<span className="text-emerald-400">Tracker</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="mt-auto rounded-md px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
    </div>
  );
}
