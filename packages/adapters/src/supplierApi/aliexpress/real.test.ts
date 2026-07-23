import { describe, expect, it, vi } from 'vitest';
import { RealAliExpressClient } from './real.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealAliExpressClient — session param', () => {
  it('includes session (the account-scoped OAuth token) in the signed request body when ALIEXPRESS_ACCESS_TOKEN is set', async () => {
    let capturedBody: URLSearchParams | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = new URLSearchParams(init?.body as string);
        return jsonResponse({ ds_text_search_response: { data: { products: [] } } });
      }),
    );

    const client = new RealAliExpressClient({
      ALIEXPRESS_APP_KEY: 'app-key-1',
      ALIEXPRESS_APP_SECRET: 'app-secret-1',
      ALIEXPRESS_ACCESS_TOKEN: 'session-token-xyz',
    });
    await client.searchProduct('widget');

    expect(capturedBody?.get('session')).toBe('session-token-xyz');
    vi.unstubAllGlobals();
  });

  it('omits session when ALIEXPRESS_ACCESS_TOKEN is not set, rather than sending an empty string', async () => {
    let capturedBody: URLSearchParams | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = new URLSearchParams(init?.body as string);
        return jsonResponse({ ds_text_search_response: { data: { products: [] } } });
      }),
    );

    const client = new RealAliExpressClient({ ALIEXPRESS_APP_KEY: 'app-key-1', ALIEXPRESS_APP_SECRET: 'app-secret-1' });
    await client.searchProduct('widget');

    expect(capturedBody?.has('session')).toBe(false);
    vi.unstubAllGlobals();
  });
});
