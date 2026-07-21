import { describe, expect, it } from 'vitest';
import { MockSessionVerifier } from './mock.js';

describe('MockSessionVerifier', () => {
  const verifier = new MockSessionVerifier();

  it('accepts the dev-user bearer token', async () => {
    const request = new Request('https://example.com', {
      headers: { Authorization: 'Bearer dev-user' },
    });
    expect(await verifier.verifySession(request)).toEqual({ clerkUserId: 'dev-user' });
  });

  it('rejects a missing Authorization header', async () => {
    const request = new Request('https://example.com');
    expect(await verifier.verifySession(request)).toBeNull();
  });

  it('rejects a non-Bearer Authorization header', async () => {
    const request = new Request('https://example.com', { headers: { Authorization: 'Basic abc' } });
    expect(await verifier.verifySession(request)).toBeNull();
  });
});
