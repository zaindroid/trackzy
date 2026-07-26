import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshAliexpressToken } from './aliexpressToken.js';

afterEach(() => vi.unstubAllGlobals());

describe('refreshAliexpressToken', () => {
  it('returns the fresh access_token on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ access_token: 'fresh_abc', refresh_token: 'rt2', code: '0' }), { status: 200 })),
    );
    expect(await refreshAliexpressToken('540440', 'secret', 'rt')).toBe('fresh_abc');
  });

  it('returns null when the API reports an error (no access_token)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'InvalidToken', message: 'bad' }), { status: 200 })));
    expect(await refreshAliexpressToken('540440', 'secret', 'rt')).toBeNull();
  });

  it('returns null on a non-200 (caller falls back to static token)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await refreshAliexpressToken('540440', 'secret', 'rt')).toBeNull();
  });
});
