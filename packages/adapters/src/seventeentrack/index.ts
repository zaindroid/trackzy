import { isMockMode } from '../mockMode.js';
import type { SeventeenTrackEnv, TrackingEvents } from './iface.js';
import { RealTrackingEvents } from './real.js';
import { MockTrackingEvents } from './mock.js';

export * from './iface.js';
export { RealTrackingEvents } from './real.js';
export { MockTrackingEvents } from './mock.js';

export function createTrackingEvents(env: SeventeenTrackEnv): TrackingEvents {
  if (isMockMode(env.MOCK_MODE, env.SEVENTEENTRACK_API_KEY)) {
    return new MockTrackingEvents();
  }
  return new RealTrackingEvents(env);
}
