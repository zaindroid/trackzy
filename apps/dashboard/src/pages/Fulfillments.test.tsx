import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FulfillmentsPage } from './Fulfillments.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const NEEDS_REVIEW_FULFILLMENT = {
  id: 'ff_needs_review',
  orderId: 'ord1',
  supplierId: 'sup1',
  costCents: 6200,
  trackingNumber: '9200111899223197428499',
  carrierDeclared: null,
  carrierDetected: 'USPS',
  carrierFinal: null,
  trackingStatus: 'needs_review',
  pushedToStorefront: 0,
  source: 'gemini',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

describe('FulfillmentsPage — Needs-review resolve flow', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ ok: true, carrierFinal: 'USPS' }), { status: 200 });
      }
      if (url.includes('/api/fulfillments')) {
        return new Response(JSON.stringify({ fulfillments: [NEEDS_REVIEW_FULFILLMENT] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('calls PATCH /api/fulfillments/:id with the chosen carrier when resolving', async () => {
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentsPage />);

    // Switch to the Needs review tab.
    await user.click(screen.getByText('Needs review'));
    await waitFor(() => expect(screen.getByDisplayValue('9200111899223197428499')).toBeInTheDocument());

    await user.selectOptions(screen.getByRole('combobox'), 'USPS');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
      expect(patchCall).toBeDefined();
    });

    const [url, init] = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH')!;
    expect(String(url)).toContain('/api/fulfillments/ff_needs_review');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.carrierFinal).toBe('USPS');
    expect(body.trackingNumber).toBe('9200111899223197428499');
  });
});
