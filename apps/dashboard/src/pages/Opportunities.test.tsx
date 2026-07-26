import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpportunitiesPage } from './Opportunities.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const SEED_HISTORY = [
  {
    id: 'opp1',
    keyword: 'wireless earbuds',
    totalSold: 340,
    uniqueSellers: 12,
    avgPriceCents: 2999,
    medianPriceCents: 2500,
    freeShippingPercent: 65,
    opportunityScore: 72.5,
    sampleListings: [{ title: 'Wireless Earbuds Pro', url: 'https://www.ebay.com/itm/1', priceCents: 2999 }],
    scannedAt: Date.now(),
    aiVerdict: null,
    aiSellPriceMinCents: null,
    aiSellPriceMaxCents: null,
    aiTargetSourcePriceCents: null,
    aiMarginEstimateCents: null,
    aiRisk: null,
    recommendedKeywords: null,
  },
];

describe('OpportunitiesPage', () => {
  it('renders past scan history with score and sample sold listings on expand', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/product-opportunities')) {
          return new Response(JSON.stringify({ opportunities: SEED_HISTORY }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<OpportunitiesPage />);

    await waitFor(() => expect(screen.getByText('wireless earbuds')).toBeInTheDocument());
    expect(screen.getByText('72.5/100')).toBeInTheDocument();
    expect(screen.getByText('$29.99')).toBeInTheDocument();

    await user.click(screen.getByText('wireless earbuds'));
    expect(screen.getByText('Wireless Earbuds Pro')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('runs a new plain search and refreshes the history', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/api/product-opportunities/search')) {
        return new Response(JSON.stringify({ ...SEED_HISTORY[0], keyword: 'gaming mouse' }), { status: 200 });
      }
      if (url.includes('/api/product-opportunities')) {
        return new Response(JSON.stringify({ opportunities: [] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<OpportunitiesPage />);

    await waitFor(() => expect(screen.getByPlaceholderText('e.g. wireless earbuds')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('e.g. wireless earbuds'), 'gaming mouse');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/product-opportunities/search') && (i as RequestInit)?.method === 'POST');
      expect(call).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/product-opportunities/search'))!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ keyword: 'gaming mouse', deepSearch: false });

    vi.unstubAllGlobals();
  });

  it('sends deepSearch: true and renders the AI verdict block when present', async () => {
    const DEEP_RESULT = {
      ...SEED_HISTORY[0],
      keyword: 'gadget',
      aiVerdict: 'Worth listing — solid margin, low competition.',
      aiSellPriceMinCents: 1500,
      aiSellPriceMaxCents: 2500,
      aiTargetSourcePriceCents: 600,
      aiMarginEstimateCents: 1400,
      aiRisk: 'Seasonal demand.',
      recommendedKeywords: ['gadget premium'],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/api/product-opportunities/search')) {
        return new Response(JSON.stringify(DEEP_RESULT), { status: 200 });
      }
      if (url.includes('/api/product-opportunities')) {
        return new Response(JSON.stringify({ opportunities: [DEEP_RESULT] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<OpportunitiesPage />);

    await waitFor(() => expect(screen.getByPlaceholderText('e.g. wireless earbuds')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('e.g. wireless earbuds'), 'gadget');
    await user.click(screen.getByLabelText('Deep search'));
    await user.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/product-opportunities/search') && (i as RequestInit)?.method === 'POST');
      expect(call).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/product-opportunities/search'))!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ keyword: 'gadget', deepSearch: true });

    await waitFor(() => expect(screen.getByText('gadget')).toBeInTheDocument());
    await user.click(screen.getByText('gadget'));
    expect(screen.getByText(/Worth listing/)).toBeInTheDocument();
    expect(screen.getByText(/Seasonal demand/)).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
