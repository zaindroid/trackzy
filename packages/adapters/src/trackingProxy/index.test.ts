import { describe, expect, it } from 'vitest';
import { createTrackingProxyClient } from './index.js';
import { MockTrackTacoClient } from './trackTaco/mock.js';
import { RealTrackTacoClient } from './trackTaco/real.js';
import { MockTrackCaptainClient } from './trackCaptain/mock.js';
import { RealTrackCaptainClient } from './trackCaptain/real.js';
import { MockBluecareExpressClient } from './bluecareExpress/mock.js';
import { RealBluecareExpressClient } from './bluecareExpress/real.js';
import { MockAquilineClient } from './aquiline/mock.js';
import { RealAquilineClient } from './aquiline/real.js';

describe('createTrackingProxyClient', () => {
  it('defaults to TrackTaco mock in MOCK_MODE', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'true' });
    expect(client).toBeInstanceOf(MockTrackTacoClient);
  });

  it('defaults to the real TrackTaco client when a real key is set and mock mode is off', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'false', TRACKTACO_API_KEY: 'tt_live_real-key' });
    expect(client).toBeInstanceOf(RealTrackTacoClient);
  });

  it('switches to the TrackCaptain mock when TRACKING_PROXY_PROVIDER=trackcaptain', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'true', TRACKING_PROXY_PROVIDER: 'trackcaptain' });
    expect(client).toBeInstanceOf(MockTrackCaptainClient);
  });

  it('returns the real TrackCaptain client when explicitly selected with a real key and mock mode off', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'false', TRACKING_PROXY_PROVIDER: 'trackcaptain', TRACKCAPTAIN_API_KEY: 'tc_live_real-key' });
    expect(client).toBeInstanceOf(RealTrackCaptainClient);
  });

  it('switches to the Bluecare Express mock when TRACKING_PROXY_PROVIDER=bluecare_express (explicit opt-in to a dead provider)', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'true', TRACKING_PROXY_PROVIDER: 'bluecare_express' });
    expect(client).toBeInstanceOf(MockBluecareExpressClient);
  });

  it('returns the real Bluecare Express client when explicitly selected with a real key and mock mode off', () => {
    const client = createTrackingProxyClient({ MOCK_MODE: 'false', TRACKING_PROXY_PROVIDER: 'bluecare_express', BLUECARE_EXPRESS_API_KEY: 'real-key' });
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
