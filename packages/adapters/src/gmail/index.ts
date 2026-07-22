import { isMockMode } from '../mockMode.js';
import type { OAuthTokenSet, OnTokenRefreshed } from '../orderSource/iface.js';
import type { GmailClient, GmailEnv } from './iface.js';
import { RealGmailClient } from './real.js';
import { MockGmailClient } from './mock.js';

export * from './iface.js';
export { RealGmailClient } from './real.js';
export { MockGmailClient } from './mock.js';

export function createGmailClient(env: GmailEnv, tokens: OAuthTokenSet, onTokenRefreshed: OnTokenRefreshed): GmailClient {
  if (isMockMode(env.MOCK_MODE, env.GMAIL_CLIENT_ID, env.GMAIL_CLIENT_SECRET)) {
    return new MockGmailClient();
  }
  return new RealGmailClient(env, tokens, onTokenRefreshed);
}
