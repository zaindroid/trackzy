import { describe, expect, it } from 'vitest';
import { createAmazonOrderSource } from './index.js';
import { MockAmazonOrderSource } from './mock.js';
import { RealAmazonOrderSource } from './real.js';

const TOKENS = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 };
const NOOP_REFRESH = async () => undefined;

describe('createAmazonOrderSource', () => {
  it('returns the mock when MOCK_MODE=true', () => {
    const source = createAmazonOrderSource(
      { MOCK_MODE: 'true', AMAZON_LWA_CLIENT_ID: 'real-id', AMAZON_LWA_CLIENT_SECRET: 'real-secret' },
      TOKENS,
      NOOP_REFRESH,
    );
    expect(source).toBeInstanceOf(MockAmazonOrderSource);
  });

  it('returns the mock when credentials are unfilled placeholders', () => {
    const source = createAmazonOrderSource(
      { MOCK_MODE: 'false', AMAZON_LWA_CLIENT_ID: 'PLACEHOLDER__AMAZON_LWA_CLIENT_ID', AMAZON_LWA_CLIENT_SECRET: 'PLACEHOLDER__AMAZON_LWA_CLIENT_SECRET' },
      TOKENS,
      NOOP_REFRESH,
    );
    expect(source).toBeInstanceOf(MockAmazonOrderSource);
  });

  it('returns the real client when credentials look real and mock mode is off', () => {
    const source = createAmazonOrderSource(
      { MOCK_MODE: 'false', AMAZON_LWA_CLIENT_ID: 'real-id', AMAZON_LWA_CLIENT_SECRET: 'real-secret' },
      TOKENS,
      NOOP_REFRESH,
    );
    expect(source).toBeInstanceOf(RealAmazonOrderSource);
  });
});
