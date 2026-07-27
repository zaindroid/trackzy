import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Storefront, type Supplier } from '../lib/api.js';
import { Button, PageHeader, Panel, TextInput } from '../components/ui.js';

function ConnectionCard({
  title,
  description,
  connected,
  children,
}: {
  title: string;
  description: string;
  connected: boolean;
  children: ReactNode;
}) {
  return (
    <Panel title={title} className="mb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-ink-muted">{description}</p>
          {connected && <span className="mt-2 inline-block rounded-sm bg-moss/15 px-2 py-0.5 text-xs font-medium text-moss">Connected</span>}
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </Panel>
  );
}

export function ConnectionsPage() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();

  const storefrontsQuery = useQuery({
    queryKey: ['storefronts'],
    queryFn: () => apiFetch<{ storefronts: Storefront[] }>('/storefronts', token),
  });
  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<{ suppliers: Supplier[] }>('/suppliers', token),
  });

  const ebayConnected = Boolean(storefrontsQuery.data?.storefronts.some((s) => s.platform === 'ebay'));
  const aliexpressConnected = Boolean(suppliersQuery.data?.suppliers.some((s) => s.provider === 'aliexpress'));
  const cjConnected = Boolean(suppliersQuery.data?.suppliers.some((s) => s.provider === 'cj'));
  const amazonRetailConnected = Boolean(suppliersQuery.data?.suppliers.some((s) => s.provider === 'amazon_retail'));
  const temuConnected = Boolean(suppliersQuery.data?.suppliers.some((s) => s.provider === 'manual' && s.name === 'Temu (Manual)'));

  const startOAuth = useMutation({
    mutationFn: (provider: 'ebay' | 'aliexpress') => apiFetch<{ redirectUrl: string }>(`/connections/${provider}/start`, token),
    onSuccess: (data) => {
      window.location.href = data.redirectUrl;
    },
  });

  const syncListings = useMutation({
    mutationFn: () => apiFetch('/listings/sync', token, { method: 'POST' }),
  });

  const connectManual = useMutation({
    mutationFn: (provider: 'amazon_retail' | 'temu') =>
      apiFetch('/connections/manual', token, { method: 'POST', body: JSON.stringify({ provider }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });

  const [cjApiKey, setCjApiKey] = useState('');
  const [cjReplacing, setCjReplacing] = useState(false);
  const connectCj = useMutation({
    mutationFn: () => apiFetch('/connections/cj', token, { method: 'POST', body: JSON.stringify({ apiKey: cjApiKey }) }),
    onSuccess: () => {
      setCjApiKey('');
      setCjReplacing(false);
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Setup"
        title="Connections"
        description="Connect your own eBay account and the suppliers you fulfill from — everything else runs automatically from here."
      />

      <ConnectionCard title="eBay" description="Your storefront — where listings and orders come from." connected={ebayConnected}>
        {!ebayConnected && (
          <Button variant="primary" onClick={() => startOAuth.mutate('ebay')} disabled={startOAuth.isPending}>
            Connect eBay
          </Button>
        )}
        {ebayConnected && (
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => syncListings.mutate()} disabled={syncListings.isPending}>
              {syncListings.isPending ? 'Syncing…' : 'Sync listings now'}
            </Button>
            <button
              type="button"
              className="text-xs text-ink-muted underline hover:text-ink disabled:opacity-50"
              onClick={() => startOAuth.mutate('ebay')}
              disabled={startOAuth.isPending}
            >
              Reconnect
            </button>
          </div>
        )}
      </ConnectionCard>
      {startOAuth.isError && startOAuth.variables === 'ebay' && (
        <p className="-mt-3 mb-4 text-sm text-brick">{(startOAuth.error as Error).message}</p>
      )}
      {syncListings.isSuccess && <p className="-mt-3 mb-4 text-sm text-moss">Listings synced.</p>}
      {syncListings.isError && <p className="-mt-3 mb-4 text-sm text-brick">{(syncListings.error as Error).message}</p>}

      <ConnectionCard title="AliExpress" description="Automated ordering via AliExpress's Dropshipping API." connected={aliexpressConnected}>
        {aliexpressConnected ? (
          <button
            type="button"
            className="text-xs text-ink-muted underline hover:text-ink disabled:opacity-50"
            onClick={() => startOAuth.mutate('aliexpress')}
            disabled={startOAuth.isPending}
          >
            Reconnect
          </button>
        ) : (
          <Button variant="primary" onClick={() => startOAuth.mutate('aliexpress')} disabled={startOAuth.isPending}>
            Connect AliExpress
          </Button>
        )}
      </ConnectionCard>
      {startOAuth.isError && startOAuth.variables === 'aliexpress' && (
        <p className="-mt-3 mb-4 text-sm text-brick">{(startOAuth.error as Error).message}</p>
      )}

      <ConnectionCard title="CJ Dropshipping" description="Automated ordering via CJ's API." connected={cjConnected}>
        {!cjConnected || cjReplacing ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput
              placeholder="Your CJ dashboard API key"
              value={cjApiKey}
              onChange={(e) => setCjApiKey(e.target.value)}
              className="sm:w-64"
            />
            <Button variant="primary" onClick={() => connectCj.mutate()} disabled={connectCj.isPending || !cjApiKey}>
              {cjConnected ? 'Update key' : 'Connect'}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="text-xs text-ink-muted underline hover:text-ink"
            onClick={() => setCjReplacing(true)}
          >
            Reconnect
          </button>
        )}
        {connectCj.isError && <p className="mt-2 text-sm text-brick">{(connectCj.error as Error).message}</p>}
      </ConnectionCard>

      <ConnectionCard
        title="Amazon Retail"
        description="Manual mode — orders placed with one click."
        connected={amazonRetailConnected}
      >
        {!amazonRetailConnected && (
          <Button variant="primary" onClick={() => connectManual.mutate('amazon_retail')} disabled={connectManual.isPending}>
            Enable
          </Button>
        )}
      </ConnectionCard>

      <ConnectionCard
        title="Temu"
        description="Manual mode — orders placed with one click."
        connected={temuConnected}
      >
        {!temuConnected && (
          <Button variant="primary" onClick={() => connectManual.mutate('temu')} disabled={connectManual.isPending}>
            Enable
          </Button>
        )}
      </ConnectionCard>
    </div>
  );
}
