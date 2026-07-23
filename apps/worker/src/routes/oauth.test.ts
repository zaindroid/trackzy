import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('GET /oauth/aliexpress/callback', () => {
  it('renders the authorization code from the query string', async () => {
    const res = await SELF.fetch('https://worker.example.com/oauth/aliexpress/callback?code=abc-123-xyz');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('abc-123-xyz');
  });

  it('escapes HTML in the code param instead of reflecting it unescaped (XSS guard)', async () => {
    const res = await SELF.fetch(
      'https://worker.example.com/oauth/aliexpress/callback?code=' + encodeURIComponent('<script>alert(1)</script>'),
    );
    const body = await res.text();
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('handles a missing code param without erroring', async () => {
    const res = await SELF.fetch('https://worker.example.com/oauth/aliexpress/callback');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('No code present');
  });
});
