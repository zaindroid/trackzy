import { describe, expect, it } from 'vitest';
import { createEbayOrderSource } from './index.js';
import { MockEbayOrderSource } from './mock.js';
import { RealEbayOrderSource } from './real.js';

const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 };
const NOOP_REFRESH = async () => undefined;

describe('createEbayOrderSource', () => {
  it('returns the mock when MOCK_MODE=true', () => {
    const source = createEbayOrderSource(
      { MOCK_MODE: 'true', EBAY_CLIENT_ID: 'real-id', EBAY_CLIENT_SECRET: 'real-secret' },
      TOKENS,
      NOOP_REFRESH,
      false,
    );
    expect(source).toBeInstanceOf(MockEbayOrderSource);
  });

  it('returns the mock when credentials are unfilled placeholders', () => {
    const source = createEbayOrderSource(
      { MOCK_MODE: 'false', EBAY_CLIENT_ID: 'PLACEHOLDER__EBAY_CLIENT_ID', EBAY_CLIENT_SECRET: 'PLACEHOLDER__EBAY_CLIENT_SECRET' },
      TOKENS,
      NOOP_REFRESH,
      false,
    );
    expect(source).toBeInstanceOf(MockEbayOrderSource);
  });

  it('returns the real client when credentials look real and mock mode is off', () => {
    const source = createEbayOrderSource(
      { MOCK_MODE: 'false', EBAY_CLIENT_ID: 'real-id', EBAY_CLIENT_SECRET: 'real-secret' },
      TOKENS,
      NOOP_REFRESH,
      false,
    );
    expect(source).toBeInstanceOf(RealEbayOrderSource);
  });
});
