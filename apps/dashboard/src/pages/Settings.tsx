import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Settings } from '../lib/api.js';

export function SettingsPage() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: Settings }>('/settings', token),
  });

  const [minMarginCents, setMinMarginCents] = useState(200);
  const [marginMode, setMarginMode] = useState<'absolute' | 'percent'>('absolute');
  const [minMarginPercent, setMinMarginPercent] = useState(10);
  const [autoFulfill, setAutoFulfill] = useState(true);

  useEffect(() => {
    if (query.data) {
      setMinMarginCents(query.data.settings.minMarginCents);
      setMarginMode(query.data.settings.marginMode);
      setMinMarginPercent(query.data.settings.minMarginPercent);
      setAutoFulfill(Boolean(query.data.settings.autoFulfill));
    }
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch('/settings', token, {
        method: 'PATCH',
        body: JSON.stringify({ minMarginCents, marginMode, minMarginPercent, autoFulfill }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold text-slate-100">Settings</h1>

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Margin threshold</h2>
        <div className="mb-3 flex items-center gap-3">
          <label className="text-sm text-slate-400">
            <input
              type="radio"
              checked={marginMode === 'absolute'}
              onChange={() => setMarginMode('absolute')}
              className="mr-1.5"
            />
            Absolute (cents)
          </label>
          <label className="text-sm text-slate-400">
            <input
              type="radio"
              checked={marginMode === 'percent'}
              onChange={() => setMarginMode('percent')}
              className="mr-1.5"
            />
            Percent of subtotal
          </label>
        </div>
        {marginMode === 'absolute' ? (
          <input
            type="number"
            value={minMarginCents}
            onChange={(e) => setMinMarginCents(Number(e.target.value))}
            className="w-40 rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
          />
        ) : (
          <input
            type="number"
            value={minMarginPercent}
            onChange={(e) => setMinMarginPercent(Number(e.target.value))}
            className="w-40 rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
          />
        )}

        <div className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            id="auto-fulfill"
            checked={autoFulfill}
            onChange={(e) => setAutoFulfill(e.target.checked)}
          />
          <label htmlFor="auto-fulfill" className="text-sm text-slate-400">
            Auto-fulfill orders that clear the margin threshold
          </label>
        </div>

        <button
          onClick={() => saveMutation.mutate()}
          className="mt-4 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400"
        >
          Save settings
        </button>
        {saveMutation.isSuccess && <span className="ml-3 text-sm text-emerald-400">Saved.</span>}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Storefront &amp; API keys</h2>
        <p className="text-sm text-slate-500">
          Storefront access tokens, webhook secrets, and supplier API keys are managed as Cloudflare
          Worker secrets, not through this UI — see <code>DEPLOY.md</code> for the exact{' '}
          <code>wrangler secret put</code> commands. This keeps real credentials out of the database and
          out of the browser entirely.
        </p>
      </section>
    </div>
  );
}
