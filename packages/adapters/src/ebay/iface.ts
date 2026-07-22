import type { OAuthTokenSet, OnTokenRefreshed } from '../orderSource/iface.js';

export interface EbayEnv {
  MOCK_MODE?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_API_BASE_URL?: string; // override for sandbox testing; defaults to production
}

export interface EbayOrderSourceConfig {
  tokens: OAuthTokenSet;
  onTokenRefreshed: OnTokenRefreshed;
  /** spec 5a: bypasses the Fulfillment API for pushTracking, routes through the extension instead. */
  nonApiMode: boolean;
}
