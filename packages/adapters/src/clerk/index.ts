import { isMockMode } from '../mockMode.js';
import type { ClerkEnv, SessionVerifier } from './iface.js';
import { RealSessionVerifier } from './real.js';
import { MockSessionVerifier } from './mock.js';

export * from './iface.js';
export { RealSessionVerifier } from './real.js';
export { MockSessionVerifier } from './mock.js';

export function createSessionVerifier(env: ClerkEnv): SessionVerifier {
  if (isMockMode(env.MOCK_MODE, env.CLERK_SECRET_KEY)) {
    return new MockSessionVerifier();
  }
  return new RealSessionVerifier(env);
}
