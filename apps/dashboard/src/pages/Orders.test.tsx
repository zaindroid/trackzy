import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { OrdersPage } from './Orders.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

const SEED_ORDERS = [
  {
    id: 'ord1',
    storefrontId: 'sf1',
    externalOrderId: 'gid://shopify/Order/1',
    externalOrderNumber: '#1001',
    status: 'shipped',
    currency: 'USD',
    subtotalCents: 8900,
    shippingCents: 599,
    marginCents: 2101,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'ord2',
    storefrontId: 'sf1',
    externalOrderId: 'gid://shopify/Order/2',
    externalOrderNumber: '#1002',
    status: 'rejected',
    currency: 'USD',
    subtotalCents: 3200,
    shippingCents: 400,
    marginCents: -150,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

const SEED_METRICS = {
  ordersToday: 2,
  avgMarginCents: 975,
  autoExtractedRegexPercent: 80,
  autoExtractedGeminiPercent: 20,
  exceptionsOpen: 1,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/metrics')) {
        return new Response(JSON.stringify(SEED_METRICS), { status: 200 });
      }
      if (url.includes('/api/orders')) {
        return new Response(JSON.stringify({ orders: SEED_ORDERS }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
});

describe('OrdersPage', () => {
  it('renders seed order data in the table, including status and margin', async () => {
    renderWithProviders(<OrdersPage />);

    await waitFor(() => expect(screen.getByText('#1001')).toBeInTheDocument());
    const table = within(screen.getByRole('table'));
    expect(screen.getByText('#1002')).toBeInTheDocument();
    expect(table.getByText('shipped')).toBeInTheDocument();
    expect(table.getByText('rejected')).toBeInTheDocument();
    expect(table.getByText('$21.01')).toBeInTheDocument();
  });

  it('renders the metrics strip from seed data', async () => {
    renderWithProviders(<OrdersPage />);
    await waitFor(() => expect(screen.getByText('Orders today')).toBeInTheDocument());
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // exceptions open
  });
});
