import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';
import { HomePage } from './Home.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import { AuthContext, type AuthContextValue } from '../lib/auth.js';
import type { ListingMonitor, ProductCandidate } from '../lib/api.js';

const MONITOR: ListingMonitor = {
  candidateId: 'mon1',
  title: 'Magnetic Phone Mount',
  imageUrl: null,
  ebayItemId: 'EBAY1',
  enabled: true,
  health: 'healthy',
  stockStatus: 'in',
  minMarginPercent: 20,
  priceCeilingCents: null,
  currentSellPriceCents: 1999,
  currentSupplierCostCents: 500,
  currentMarginPercent: 50,
  lastAction: null,
  lastReason: null,
  lastCheckedAt: Date.now(),
  marginSpark: [],
  pendingSwitch: null,
};

const CANDIDATE: ProductCandidate = {
  id: 'cand1',
  keyword: 'silk eye mask',
  ebayAvgSoldPriceCents: 1500,
  ebayMedianPriceCents: 1499,
  ebaySoldCount: 20,
  supplierProvider: 'cj',
  supplierProductId: 'CJ1',
  supplierCostCents: 400,
  supplierProductUrl: 'https://cjdropshipping.com/product/CJ1',
  supplierImageUrls: ['https://img/1.jpg'],
  marginCents: 900,
  marginPercent: 60,
  opportunityScore: 55,
  suggestedSellPriceCents: 1499,
  generatedTitle: 'Silk Sleep Eye Mask Blackout Soft',
  generatedDescription: '<p>Nice mask</p>',
  generatedAspects: { Brand: 'Unbranded' },
  categoryId: null,
  status: 'draft',
  ebayItemId: null,
  createdAt: Date.now(),
};

describe('HomePage', () => {
  it('renders stat tiles from monitor and candidate data', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/monitor')) {
        return new Response(JSON.stringify({ monitors: [MONITOR] }), { status: 200 });
      }
      if (url.includes('/api/product-research')) {
        return new Response(JSON.stringify({ candidates: [CANDIDATE] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<HomePage />);

    await waitFor(() => expect(screen.getByText('Silk Sleep Eye Mask Blackout Soft')).toBeInTheDocument());

    expect(screen.getByText('Active listings').nextSibling?.textContent).toBe('1');
    expect(screen.getByText('Needs attention').nextSibling?.textContent).toBe('0');
    expect(screen.getByText('Draft candidates').nextSibling?.textContent).toBe('1');

    vi.unstubAllGlobals();
  });

  it('shows a loading state instead of empty/zeroed content while queries are in flight', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const authValue: AuthContextValue = {
      token: 'dev-user',
      getToken: async () => 'dev-user',
      loginAsDevUser: () => undefined,
      logout: () => undefined,
    };
    // Fetch never resolves, so both queries stay in the loading state.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter>
            <HomePage />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Loading your overview…')).toBeInTheDocument();
    expect(screen.queryByText('No research yet — head to Product research to find your first winners.')).not.toBeInTheDocument();
    expect(screen.queryByText('Active listings')).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
