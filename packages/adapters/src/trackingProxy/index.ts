import { isMockMode } from '../mockMode.js';
import type { TrackingProxyClient, TrackingProxyEnv } from './iface.js';
import { RealTrackTacoClient } from './trackTaco/real.js';
import { MockTrackTacoClient } from './trackTaco/mock.js';
import { RealTrackCaptainClient } from './trackCaptain/real.js';
import { MockTrackCaptainClient } from './trackCaptain/mock.js';
import { RealBluecareExpressClient } from './bluecareExpress/real.js';
import { MockBluecareExpressClient } from './bluecareExpress/mock.js';
import { RealAquilineClient } from './aquiline/real.js';
import { MockAquilineClient } from './aquiline/mock.js';

export * from './iface.js';
export { RealTrackTacoClient } from './trackTaco/real.js';
export { MockTrackTacoClient } from './trackTaco/mock.js';
export { RealTrackCaptainClient } from './trackCaptain/real.js';
export { MockTrackCaptainClient } from './trackCaptain/mock.js';
export { RealBluecareExpressClient } from './bluecareExpress/real.js';
export { MockBluecareExpressClient } from './bluecareExpress/mock.js';
export { RealAquilineClient } from './aquiline/real.js';
export { MockAquilineClient } from './aquiline/mock.js';

/**
 * Defaults to TrackTaco — chosen over TrackCaptain (both have real, working
 * APIs) after live hands-on comparison: TrackCaptain's own web dashboard
 * search returned no results for a plausible destination+date filter
 * combination, while TrackTaco's richer filter set (carrier/status/date
 * ranges, not just destination) and documented already_revealed retry
 * semantics tested cleaner. Set TRACKING_PROXY_PROVIDER=trackcaptain to use
 * it instead (still fully wired), or bluecare_express/aquiline to opt into
 * a dead provider anyway (not recommended — see their real.ts doc comments).
 */
export function createTrackingProxyClient(env: TrackingProxyEnv): TrackingProxyClient {
  const provider = env.TRACKING_PROXY_PROVIDER ?? 'tracktaco';

  if (provider === 'aquiline') {
    if (isMockMode(env.MOCK_MODE, env.AQUILINE_API_KEY)) {
      return new MockAquilineClient();
    }
    return new RealAquilineClient(env);
  }

  if (provider === 'bluecare_express') {
    if (isMockMode(env.MOCK_MODE, env.BLUECARE_EXPRESS_API_KEY)) {
      return new MockBluecareExpressClient();
    }
    return new RealBluecareExpressClient(env);
  }

  if (provider === 'trackcaptain') {
    if (isMockMode(env.MOCK_MODE, env.TRACKCAPTAIN_API_KEY)) {
      return new MockTrackCaptainClient();
    }
    return new RealTrackCaptainClient(env);
  }

  if (isMockMode(env.MOCK_MODE, env.TRACKTACO_API_KEY)) {
    return new MockTrackTacoClient();
  }
  return new RealTrackTacoClient(env);
}
