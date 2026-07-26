import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { RadarPage } from './Radar.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import type { RadarProduct } from '../lib/api.js';

const PRODUCT: RadarProduct = {
  id: 'r1',
  niche: 'phone accessories',
  productTitle: 'Magnetic Phone Mount',
  imageUrl: 'https://img/1.jpg',
  ebaySoldCount: 120,
  salesPerDay: 4,
  ebayActiveCount: 40,
  sellThroughPercent: 75,
  ebayMedianSoldPriceCents: 1599,
  aliexpressProductId: 'AE1',
  aliexpressUrl: 'https://www.aliexpress.com/item/1.html',
  aliexpressCostCents: 300,
  aliexpressRating: 4.8,
  aliexpressOrders: 5000,
  sourceable: true,
  supplierCheck: 'ok',
  marginCents: 1139,
  marginPercent: 71.2,
  opportunityScore: 72,
  lastUpdated: Date.now(),
};

describe('RadarPage', () => {
  it('renders ranked radar products in a table', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/radar')) {
        return new Response(JSON.stringify({ products: [PRODUCT], feePercentUsed: 13.25 }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<RadarPage />);

    await waitFor(() => expect(screen.getByText('Magnetic Phone Mount')).toBeInTheDocument());
    expect(screen.getByText('AliExpress ↗')).toHaveAttribute('href', 'https://www.aliexpress.com/item/1.html');
    // Margin cell shows the recomputed profit from the API.
    expect(screen.getByText('$11.39')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
