export interface TrackingProxyEnv {
  MOCK_MODE?: string;
  TRACKING_PROXY_PROVIDER?: 'bluecare_express' | 'aquiline';
  BLUECARE_EXPRESS_API_KEY?: string;
  AQUILINE_API_KEY?: string;
}

export interface ConvertTrackingResult {
  proxyTracking: string;
  proxyCarrier: string;
}

/**
 * Tracking-proxy provider (spec section 7): converts a marketplace-penalized
 * tracking number (Amazon Logistics `TBA...` when the destination is eBay)
 * into a marketplace-compliant one, to avoid Item Not Received (INR) case
 * losses and account-health penalties.
 */
export interface TrackingProxyClient {
  convertTracking(originalTracking: string, originalCarrier: string): Promise<ConvertTrackingResult>;
}
