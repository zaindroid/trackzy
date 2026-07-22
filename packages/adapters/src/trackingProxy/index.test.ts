import { describe, expect, it } from 'vitest';
import { createTrackingProxyClient } from './index.js';
import { MockBluecareExpressClient } from './bluecareExpress/mock.js';
import { RealBluecareExpressClient } from './bluecareExpress/real.js';
import { MockAquilineClient } from './aquiline/mock.js';
import { RealAquilineClient } from './aquiline/real.js';

describe('createTrackingProxyClient', () => {
  it('defaults to Bluecare Express mock in MOCK_MODE', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'true' });
    expect(client).toBeInstanceOf(MockBluecareExpressClient);
  });

  it('returns the real Bluecare Express client when a real key is set and mock mode is off', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'false', BLUECARE_EXPRESS_API_KEY: 'real-key' });
    expect(client).toBeInstanceOf(RealBluecareExpressClient);
  });

  it('switches to the Aquiline mock when TRACKING_PROXY_PROVIDER=aquiline', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'true', TRACKING_PROXY_PROVIDER: 'aquiline' });
    expect(client).toBeInstanceOf(MockAquilineClient);
  });

  it('returns the real Aquiline client when a real key is set, provider is aquiline, and mock mode is off', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'false', TRACKING_PROXY_PROVIDER: 'aquiline', AQUILINE_API_KEY: 'real-key' });
    expect(client).toBeInstanceOf(RealAquilineClient);
  });
});
