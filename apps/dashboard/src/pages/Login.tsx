import { useAuthToken } from '../lib/auth.js';

export function LoginPage() {
  const { loginAsDevUser } = useAuthToken();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950">
      <div className="w-full max-w-sm rounded-xl border border-slate-800 bg-slate-900/60 p-8 text-center">
        <div className="mb-2 text-xl font-semibold tracking-tight text-slate-100">
          Fulfillment<span className="text-emerald-400">Tracker</span>
        </div>
        <p className="mb-6 text-sm text-slate-400">B2B dropshipping fulfillment automation</p>
        <button
          onClick={loginAsDevUser}
          className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-emerald-400"
        >
          Continue as dev user
        </button>
        <p className="mt-4 text-xs text-slate-600">MOCK_MODE — Clerk is not configured for this deployment.</p>
      </div>
    </div>
  );
}
