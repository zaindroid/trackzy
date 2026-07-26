import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListingsPage } from './Listings.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const SEED_LISTINGS = [
  {
    id: 'lst1',
    storefrontId: 'sf1',
    externalListingId: 'ebay-1',
    sku: 'WIDGET-1',
    title: 'Widget One',
    priceCents: 1999,
    quantityAvailable: 5,
    supplierId: 'sup1',
    matchConfidence: 0.95,
    matchSource: 'fuzzy_title' as const,
    status: 'active' as const,
    matchedProductTitle: 'Widget One (CJ)',
    matchedProductImageUrl: 'https://picsum.photos/seed/CJ1/200',
    matchedProductUrl: 'https://www.cjdropshipping.com/product/-p-CJ1.html',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'lst2',
    storefrontId: 'sf1',
    externalListingId: 'ebay-2',
    sku: 'GADGET-2',
    title: 'Gadget Two',
    priceCents: 2500,
    quantityAvailable: 3,
    supplierId: null,
    matchConfidence: null,
    matchSource: null,
    status: 'active' as const,
    matchedProductTitle: null,
    matchedProductImageUrl: null,
    matchedProductUrl: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const SEED_SUPPLIERS = [{ id: 'sup1', userId: 'u1', name: 'CJ Dropshipping', apiBaseUrl: '', apiKeyRef: '', emailSenderPattern: '', parserId: '', active: 1, kind: 'api', provider: 'cj', createdAt: 0 }];

function stubFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url.includes('/api/listings/sync')) {
      return new Response(JSON.stringify({ storefronts: [] }), { status: 200 });
    }
    if (url.includes('/api/listings')) {
      return new Response(JSON.stringify({ listings: SEED_LISTINGS }), { status: 200 });
    }
    if (url.includes('/api/suppliers')) {
      return new Response(JSON.stringify({ suppliers: SEED_SUPPLIERS }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describe('ListingsPage', () => {
  it('renders the matched product\'s title/image for a matched listing, and "Unmatched" for one with no match', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderWithProviders(<ListingsPage />);

    await waitFor(() => expect(screen.getByText('Widget One')).toBeInTheDocument());
    expect(screen.getByText('$19.99 · qty 5')).toBeInTheDocument();
    expect(screen.getByText('Widget One (CJ)')).toBeInTheDocument(); // the matched supplier product's own title
    expect(screen.getByAltText('Widget One (CJ)')).toHaveAttribute('src', 'https://picsum.photos/seed/CJ1/200');
    expect(screen.getByText(/CJ Dropshipping/)).toBeInTheDocument();
    expect(screen.getByText('95% (fuzzy_title)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View ↗' })).toHaveAttribute('href', 'https://www.cjdropshipping.com/product/-p-CJ1.html');

    expect(screen.getByText('Gadget Two')).toBeInTheDocument();
    expect(screen.getByText('Unmatched')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('triggers a manual sync on "Sync now" click', async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ListingsPage />);

    await waitFor(() => expect(screen.getByText('Widget One')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Sync now' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/api/listings/sync') && (i as RequestInit)?.method === 'POST');
      expect(call).toBeDefined();
    });

    vi.unstubAllGlobals();
  });

  it('lets a human resolve an unmatched listing by picking a candidate card (with its image), or explicitly leaving it unmatched', async () => {
    const CANDIDATES = [
      {
        supplierId: 'sup1',
        supplierName: 'CJ Dropshipping',
        supplierProductId: 'CJ123',
        title: 'Gadget Two (CJ)',
        sku: '',
        costCents: 1500,
        score: 0.72,
        imageUrl: 'https://picsum.photos/seed/CJ123/200',
        productUrl: 'https://www.cjdropshipping.com/product/-p-CJ123.html',
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/listings/lst2/candidates')) {
        return new Response(JSON.stringify({ candidates: CANDIDATES }), { status: 200 });
      }
      if (init?.method === 'POST' && url.includes('/api/listings/lst2/match')) {
        return new Response(JSON.stringify({ ok: true, supplierId: 'sup1' }), { status: 200 });
      }
      if (init?.method === 'POST' && url.includes('/api/listings/sync')) {
        return new Response(JSON.stringify({ storefronts: [] }), { status: 200 });
      }
      if (url.includes('/api/listings')) {
        return new Response(JSON.stringify({ listings: SEED_LISTINGS }), { status: 200 });
      }
      if (url.includes('/api/suppliers')) {
        return new Response(JSON.stringify({ suppliers: SEED_SUPPLIERS }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ListingsPage />);

    await waitFor(() => expect(screen.getByText('Gadget Two')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(screen.getByText('Gadget Two (CJ)')).toBeInTheDocument());
    expect(screen.getByAltText('Gadget Two (CJ)')).toHaveAttribute('src', 'https://picsum.photos/seed/CJ123/200');

    await user.click(screen.getByText('Gadget Two (CJ)'));
    await user.click(screen.getByRole('button', { name: 'Confirm match' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/api/listings/lst2/match') && (i as RequestInit)?.method === 'POST');
      expect(call).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/listings/lst2/match'))!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      supplierId: 'sup1',
      supplierProductId: 'CJ123',
      title: 'Gadget Two (CJ)',
      imageUrl: 'https://picsum.photos/seed/CJ123/200',
      productUrl: 'https://www.cjdropshipping.com/product/-p-CJ123.html',
    });

    vi.unstubAllGlobals();
  });

  it('lets a human explicitly mark a listing as reviewed with no match', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/listings/lst2/candidates')) {
        return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
      }
      if (init?.method === 'POST' && url.includes('/api/listings/lst2/match')) {
        return new Response(JSON.stringify({ ok: true, supplierId: null }), { status: 200 });
      }
      if (url.includes('/api/listings')) {
        return new Response(JSON.stringify({ listings: SEED_LISTINGS }), { status: 200 });
      }
      if (url.includes('/api/suppliers')) {
        return new Response(JSON.stringify({ suppliers: SEED_SUPPLIERS }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ListingsPage />);

    await waitFor(() => expect(screen.getByText('Gadget Two')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(screen.getByText(/No candidate products found/)).toBeInTheDocument());

    await user.click(screen.getByText("Don't match — leave unmatched"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/api/listings/lst2/match') && (i as RequestInit)?.method === 'POST');
      expect(call).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/listings/lst2/match'))!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ supplierId: null });

    vi.unstubAllGlobals();
  });
});
