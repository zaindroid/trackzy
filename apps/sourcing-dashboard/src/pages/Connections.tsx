import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ConnectionStatus } from '../lib/api.js';
import { Badge, Button, PageHeader, Panel, TextInput } from '../components/ui.js';

export function ConnectionsPage() {
  const { getToken } = useAuthToken();
  const queryClient = useQueryClient();
  const [cjKey, setCjKey] = useState('');

  const statusQuery = useQuery({
    queryKey: ['connectionStatus'],
    queryFn: () => apiFetch<ConnectionStatus>('/connections/status', getToken),
  });

  const startEbay = useMutation({
    mutationFn: () => apiFetch<{ redirectUrl: string }>('/connections/ebay/start', getToken),
    onSuccess: (data) => {
      window.location.href = data.redirectUrl;
    },
  });

  const connectCj = useMutation({
    mutationFn: () => apiFetch('/connections/cj', getToken, { method: 'POST', body: JSON.stringify({ apiKey: cjKey }) }),
    onSuccess: () => {
      setCjKey('');
      queryClient.invalidateQueries({ queryKey: ['connectionStatus'] });
    },
  });

  const ebayConnected = statusQuery.data?.ebayConnected ?? false;
  const cjConnected = statusQuery.data?.cjConnected ?? false;

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Setup"
        title="Connections"
        description="Connect your eBay store (to publish listings) and your supplier (to source products and compute margin)."
      />

      <Panel title="eBay" className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Where researched products get published with one click.</p>
          {ebayConnected ? (
            <div className="flex items-center gap-3">
              <Badge tone="moss">Connected</Badge>
              <button
                type="button"
                className="text-xs text-ink-muted underline hover:text-ink disabled:opacity-50"
                onClick={() => startEbay.mutate()}
                disabled={startEbay.isPending}
              >
                Reconnect
              </button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => startEbay.mutate()} disabled={startEbay.isPending}>
              Connect eBay
            </Button>
          )}
        </div>
        {startEbay.isError && <p className="mt-2 text-sm text-brick">{(startEbay.error as Error).message}</p>}
      </Panel>

      <Panel title="AliExpress" className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">Your main supplier — searched automatically, no login needed (public catalog search).</p>
          <Badge tone="moss">Ready</Badge>
        </div>
      </Panel>

      <Panel title="CJ Dropshipping" className="mb-4">
        <p className="mb-2 text-sm text-ink-muted">Optional second supplier — connect your API key to also source from CJ per search.</p>
        {cjConnected ? (
          <Badge tone="moss">Connected</Badge>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput placeholder="Your CJ dashboard API key" value={cjKey} onChange={(e) => setCjKey(e.target.value)} className="sm:w-64" />
            <Button variant="primary" onClick={() => connectCj.mutate()} disabled={connectCj.isPending || !cjKey}>
              Connect
            </Button>
          </div>
        )}
        {connectCj.isError && <p className="mt-2 text-sm text-brick">{(connectCj.error as Error).message}</p>}
      </Panel>
    </div>
  );
}
