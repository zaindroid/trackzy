import { describe, expect, it } from 'vitest';
import { computeHmacSha256Base64, verifyHmacSha256 } from './hmac.js';

describe('hmac', () => {
  it('verifies a correctly signed payload', async () => {
    const secret = 'shh-its-a-secret';
    const payload = JSON.stringify({ id: 123, name: '#1001' });
    const signature = await computeHmacSha256Base64(secret, payload);
    expect(await verifyHmacSha256(secret, payload, signature)).toBe(true);
  });

  it('rejects a tampered payload', async () => {
    const secret = 'shh-its-a-secret';
    const signature = await computeHmacSha256Base64(secret, 'original');
    expect(await verifyHmacSha256(secret, 'tampered', signature)).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    const payload = 'hello world';
    const signature = await computeHmacSha256Base64('secret-a', payload);
    expect(await verifyHmacSha256('secret-b', payload, signature)).toBe(false);
  });
});
