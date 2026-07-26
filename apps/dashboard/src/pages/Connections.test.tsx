import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionsPage } from './Connections.js';
import { renderWithProviders } from '../test/renderWithProviders.js';

describe('ConnectionsPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/storefronts')) {
        return new Response(JSON.stringify({ storefronts: [] }), { status: 200 });
      }
      if (url.includes('/api/suppliers')) {
        return new Response(JSON.stringify({ suppliers: [] }), { status: 200 });
      }
      if (url.includes('/api/connections/ebay/start')) {
        return new Response(JSON.stringify({ redirectUrl: 'https://auth.ebay.com/oauth2/authorize?state=abc' }), { status: 200 });
      }
      if (url.includes('/api/connections/aliexpress/start')) {
        return new Response(
          JSON.stringify({ error: { code: 'NOT_CONFIGURED', message: 'AliExpress OAuth is not configured on this deployment yet' } }),
          { status: 503 },
        );
      }
      if (url.includes('/api/connections/manual') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'sup_new' }), { status: 201 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    // jsdom doesn't implement navigation — stub it so the eBay "Connect" click doesn't throw.
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
  });

  it('shows "Connect eBay" when no eBay storefront exists, and navigates to the returned consent URL on click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const connectButton = await screen.findByRole('button', { name: 'Connect eBay' });
    await user.click(connectButton);

    await waitFor(() => expect(window.location.href).toBe('https://auth.ebay.com/oauth2/authorize?state=abc'));
  });

  it('shows "Enable" for Amazon Retail and Temu, and calls the manual connect endpoint with the right provider', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const enableButtons = await screen.findAllByRole('button', { name: 'Enable' });
    expect(enableButtons).toHaveLength(2);

    await user.click(enableButtons[0]!);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/connections/manual'));
      expect(call).toBeDefined();
    });
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/connections/manual'))!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.provider).toBe('amazon_retail');
  });

  it('surfaces a failed connect attempt as visible text instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ConnectionsPage />);

    const connectButton = await screen.findByRole('button', { name: 'Connect AliExpress' });
    await user.click(connectButton);

    await waitFor(() => expect(screen.getByText(/AliExpress OAuth is not configured/)).toBeInTheDocument());
  });
});
