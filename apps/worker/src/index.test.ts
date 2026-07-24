import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

/**
 * Regression coverage for a real bug found live: the Chrome extension's
 * content scripts call /api/* cross-origin from whatever marketplace page
 * they're injected into (amazon.de, ebay.com, ...), and without CORS headers
 * the browser silently discards the (correctly authenticated) response
 * before the extension ever sees it. See DECISIONS.md.
 */
describe('CORS on /api/*', () => {
  it('answers an OPTIONS preflight from an arbitrary origin with Access-Control-Allow-Origin', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/extension/active-manual-task', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://www.amazon.de',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });

  it('includes Access-Control-Allow-Origin on the actual authed response too, not just the preflight', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/extension/active-manual-task', {
      headers: { Authorization: 'Bearer dev-user', Origin: 'https://www.amazon.de' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });
});
