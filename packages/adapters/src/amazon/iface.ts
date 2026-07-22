import type { OAuthTokenSet, OnTokenRefreshed } from '../orderSource/iface.js';

export interface AmazonEnv {
  MOCK_MODE?: string;
  AMAZON_LWA_CLIENT_ID?: string;
  AMAZON_LWA_CLIENT_SECRET?: string;
  AMAZON_SP_API_BASE_URL?: string; // override for a test region; defaults to NA production
  AMAZON_MARKETPLACE_ID?: string; // e.g. ATVPDKIKX0DER for amazon.com
  AMAZON_SELLER_ID?: string;
}

export interface AmazonOrderSourceConfig {
  tokens: OAuthTokenSet;
  onTokenRefreshed: OnTokenRefreshed;
}
