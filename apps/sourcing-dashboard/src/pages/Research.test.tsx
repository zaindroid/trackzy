import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResearchPage } from './Research.js';
import { renderWithProviders } from '../test/renderWithProviders.js';
import type { ProductCandidate } from '../lib/api.js';

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

describe('ResearchPage', () => {
  it('renders a candidate, then reviews and publishes it (PATCH edits + POST list)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/api/candidates/cand1/list')) {
        return new Response(JSON.stringify({ ebayItemId: 'MOCK-123', sku: 'SRC-cand1' }), { status: 200 });
      }
      if (init?.method === 'PATCH' && url.includes('/api/candidates/cand1')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/product-research')) {
        return new Response(JSON.stringify({ candidates: [CANDIDATE] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ResearchPage />);

    await waitFor(() => expect(screen.getByText('Silk Sleep Eye Mask Blackout Soft')).toBeInTheDocument());
    expect(screen.getByText('$9.00 profit')).toBeInTheDocument();
    expect(screen.getByText('View supplier product ↗')).toHaveAttribute('href', 'https://cjdropshipping.com/product/CJ1');

    // Clicking the card button opens the review modal — nothing is published yet.
    await user.click(screen.getByRole('button', { name: 'Review and list on eBay' }));
    expect(await screen.findByText('Review before publishing to eBay')).toBeInTheDocument();

    // Confirming saves edits then publishes.
    await user.click(screen.getByRole('button', { name: 'Confirm & publish to eBay' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/api/candidates/cand1') && (i as RequestInit)?.method === 'PATCH');
      const list = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/api/candidates/cand1/list') && (i as RequestInit)?.method === 'POST');
      expect(patch).toBeDefined();
      expect(list).toBeDefined();
    });

    vi.unstubAllGlobals();
  });

  it('runs a research search with the entered seed and default AliExpress supplier', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/connections/status')) {
        return new Response(JSON.stringify({ ebayConnected: false, cjConnected: false, aliexpressAvailable: true }), { status: 200 });
      }
      if (init?.method === 'POST' && url.includes('/api/product-research/research')) {
        return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
      }
      if (url.includes('/api/product-research')) {
        return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<ResearchPage />);

    await waitFor(() => expect(screen.getByPlaceholderText('e.g. silk eye mask')).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('e.g. silk eye mask'), 'phone case');
    await user.click(screen.getByRole('button', { name: 'Research products' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/product-research/research') && (i as RequestInit)?.method === 'POST');
      expect(call).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/product-research/research'))!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ seed: 'phone case', supplier: 'aliexpress' });

    vi.unstubAllGlobals();
  });
});
