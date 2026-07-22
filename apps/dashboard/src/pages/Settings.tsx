import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Settings } from '../lib/api.js';
import { Button, PageHeader, Panel, TextInput } from '../components/ui.js';

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
      <PageHeader eyebrow="Configuration" title="Settings" description="Rules the automation follows before it acts on your behalf." />

      <Panel title="Margin threshold" className="mb-6">
        <p className="mb-4 text-sm text-ink-muted">
          Orders below this margin are held for review instead of being fulfilled automatically.
        </p>
        <div className="mb-4 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              checked={marginMode === 'absolute'}
              onChange={() => setMarginMode('absolute')}
              className="accent-signal"
            />
            Absolute amount
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              checked={marginMode === 'percent'}
              onChange={() => setMarginMode('percent')}
              className="accent-signal"
            />
            Percent of subtotal
          </label>
        </div>

        {marginMode === 'absolute' ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-muted">$</span>
            <TextInput
              type="number"
              value={(minMarginCents / 100).toFixed(2)}
              onChange={(e) => setMinMarginCents(Math.round(Number(e.target.value) * 100))}
              className="w-32 font-mono"
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <TextInput
              type="number"
              value={minMarginPercent}
              onChange={(e) => setMinMarginPercent(Number(e.target.value))}
              className="w-24 font-mono"
            />
            <span className="text-sm text-ink-muted">%</span>
          </div>
        )}

        <label className="mt-5 flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={autoFulfill}
            onChange={(e) => setAutoFulfill(e.target.checked)}
            className="accent-signal"
          />
          Auto-fulfill orders that clear the margin threshold
        </label>

        <div className="mt-5 flex items-center gap-3">
          <Button variant="primary" onClick={() => saveMutation.mutate()}>
            Save settings
          </Button>
          {saveMutation.isSuccess && <span className="text-sm text-moss">Saved.</span>}
        </div>
      </Panel>

      <Panel title="Storefront & API keys">
        <p className="text-sm text-ink-muted">
          Storefront access tokens, webhook secrets, and supplier API keys are managed as Cloudflare
          Worker secrets, not through this screen — see <code className="font-mono">DEPLOY.md</code>{' '}
          for the exact <code className="font-mono">wrangler secret put</code> commands. Real
          credentials never pass through the database or the browser.
        </p>
      </Panel>
    </div>
  );
}
