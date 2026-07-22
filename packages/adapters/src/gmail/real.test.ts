import { describe, expect, it, vi } from 'vitest';
import { RealGmailClient } from './real.js';

const FIXED_TOKENS = { accessToken: 'gmail-access-token', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Base64url-encodes text the same way Gmail's API does (RFC 4648 URL-safe alphabet, no padding required on decode). */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('RealGmailClient — message body decoding', () => {
  it('decodes a single-part base64url body, including URL-safe characters', async () => {
    // Deliberately construct text whose base64 encoding is very likely to
    // contain '+' and '/' in standard base64, so the '-'/'_' substitution
    // in decodeBase64Url is actually exercised, not just padding.
    const text = 'Tracking ID: TBA123456789012\nOrder #: 111-2223334-5556667\n\xff\xfe\xfd>>>???+++///';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: 'msg-1',
          internalDate: '1700000000000',
          payload: {
            headers: [
              { name: 'Subject', value: 'Your package has shipped!' },
              { name: 'From', value: 'ship-confirm@amazon.com' },
            ],
            mimeType: 'text/plain',
            body: { data: toBase64Url(text) },
          },
        }),
      ),
    );

    const client = new RealGmailClient({}, FIXED_TOKENS, async () => undefined);
    const message = await client.getMessage('msg-1');

    expect(message.subject).toBe('Your package has shipped!');
    expect(message.from).toBe('ship-confirm@amazon.com');
    expect(message.textBody).toBe(text);
    vi.unstubAllGlobals();
  });

  it('finds the text/plain part inside a multipart message', async () => {
    const text = 'Order ID: 8012345678901234\nTracking Number: LP00123456789CN';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          id: 'msg-2',
          internalDate: '1700000000000',
          payload: {
            headers: [{ name: 'Subject', value: 'Your order has been shipped!' }],
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/html', body: { data: toBase64Url('<p>irrelevant html</p>') } },
              { mimeType: 'text/plain', body: { data: toBase64Url(text) } },
            ],
          },
        }),
      ),
    );

    const client = new RealGmailClient({}, FIXED_TOKENS, async () => undefined);
    const message = await client.getMessage('msg-2');

    expect(message.textBody).toBe(text);
    vi.unstubAllGlobals();
  });
});
