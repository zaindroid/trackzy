import { isMockMode } from '../mockMode.js';
import type { TrackingProxyClient, TrackingProxyEnv } from './iface.js';
import { RealBluecareExpressClient } from './bluecareExpress/real.js';
import { MockBluecareExpressClient } from './bluecareExpress/mock.js';
import { RealAquilineClient } from './aquiline/real.js';
import { MockAquilineClient } from './aquiline/mock.js';

export * from './iface.js';
export { RealBluecareExpressClient } from './bluecareExpress/real.js';
export { MockBluecareExpressClient } from './bluecareExpress/mock.js';
export { RealAquilineClient } from './aquiline/real.js';
export { MockAquilineClient } from './aquiline/mock.js';

/** Defaults to Bluecare Express; set TRACKING_PROXY_PROVIDER=aquiline to use the alternate provider. */
export function createTrackingProxyClient(env: TrackingProxyEnv): TrackingProxyClient {
  const provider = env.TRACKING_PROXY_PROVIDER ?? 'bluecare_express';

  if (provider === 'aquiline') {
    if (isMockMode(env.MOCK_MODE, env.AQUILINE_API_KEY)) {
      return new MockAquilineClient();
    }
    return new RealAquilineClient(env);
  }

  if (isMockMode(env.MOCK_MODE, env.BLUECARE_EXPRESS_API_KEY)) {
    return new MockBluecareExpressClient();
  }
  return new RealBluecareExpressClient(env);
}
