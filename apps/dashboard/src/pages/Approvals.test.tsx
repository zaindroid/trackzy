import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalsPage } from './Approvals.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const PENDING_ORDER = {
  id: 'pso_1',
  fulfillmentId: 'ff1',
  orderId: 'ord1',
  supplierId: 'sup1',
  supplierName: 'AliExpress',
  externalOrderNumber: '#EB-1',
  costCents: 1234,
  lineItems: [{ sku: 'GADGET-1', quantity: 2, title: 'Gadget' }],
  status: 'pending' as const,
  createdAt: Date.now(),
  decidedAt: null,
};

describe('ApprovalsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/approve')) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.includes('/api/pending-supplier-orders')) {
        return new Response(JSON.stringify({ pendingSupplierOrders: [PENDING_ORDER] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('shows the precomputed order plan and calls approve on one click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApprovalsPage />);

    await waitFor(() => expect(screen.getByText('AliExpress')).toBeInTheDocument());
    expect(screen.getByText('$12.34')).toBeInTheDocument();
    expect(screen.getByText(/GADGET-1/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve & place order' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/approve'));
      expect(call).toBeDefined();
    });
    const [url] = fetchMock.mock.calls.find(([u]) => String(u).includes('/approve'))!;
    expect(String(url)).toContain('/api/pending-supplier-orders/pso_1/approve');
  });
});
