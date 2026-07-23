import { describe, expect, it, vi } from 'vitest';
import { RealAliExpressClient } from './real.js';
import type { AliExpressTokenSet } from './iface.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ENV = { ALIEXPRESS_APP_KEY: 'app-key-1', ALIEXPRESS_APP_SECRET: 'app-secret-1' };

describe('RealAliExpressClient — session param', () => {
  it('includes session (the account-scoped OAuth token) in the signed request body when the token is still fresh', async () => {
    let capturedBody: URLSearchParams | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = new URLSearchParams(init?.body as string);
        return jsonResponse({ ds_text_search_response: { data: { products: [] } } });
      }),
    );

    const freshTokens: AliExpressTokenSet = { accessToken: 'session-token-xyz', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 };
    const client = new RealAliExpressClient(ENV, freshTokens, async () => undefined);
    await client.searchProduct('widget');

    expect(capturedBody?.get('session')).toBe('session-token-xyz');
    vi.unstubAllGlobals();
  });
});

describe('RealAliExpressClient — token refresh', () => {
  it('refreshes an expired session token before the request (AliExpress access tokens are ~1 day, so this path is exercised often), and reports the new tokens via onTokenRefreshed', async () => {
    const EXPIRED_TOKENS: AliExpressTokenSet = { accessToken: 'stale-session', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 };
    const calls: URLSearchParams[] = [];
    let refreshedArg: AliExpressTokenSet | undefined;
    const freshExpiry = Date.now() + 86_400_000;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new URLSearchParams(init?.body as string);
        calls.push(body);
        if (body.get('method') === 'auth/token/refresh') {
          return jsonResponse({ access_token: 'fresh-session', refresh_token: 'fresh-refresh', expire_time: freshExpiry });
        }
        return jsonResponse({ ds_text_search_response: { data: { products: [] } } });
      }),
    );

    const client = new RealAliExpressClient(ENV, EXPIRED_TOKENS, async (refreshed) => {
      refreshedArg = refreshed;
    });
    await client.searchProduct('widget');

    // The actual search request used the newly-refreshed token, not the stale one passed in.
    const searchCall = calls.find((c) => c.get('method') === 'aliexpress.ds.text.search');
    expect(searchCall?.get('session')).toBe('fresh-session');
    // onTokenRefreshed carries the real new token values — a caller that only
    // persisted expiry (the exact bug already fixed for Gmail/storefronts)
    // would silently keep serving the stale session on every later call.
    expect(refreshedArg?.accessToken).toBe('fresh-session');
    expect(refreshedArg?.refreshToken).toBe('fresh-refresh');
    expect(refreshedArg?.expiresAt).toBe(freshExpiry);
    vi.unstubAllGlobals();
  });
});
