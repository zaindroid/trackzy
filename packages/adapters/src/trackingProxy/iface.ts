export interface TrackingProxyEnv {
  MOCK_MODE?: string;
  TRACKING_PROXY_PROVIDER?: 'tracktaco' | 'trackcaptain' | 'bluecare_express' | 'aquiline';
  TRACKTACO_API_KEY?: string;
  TRACKCAPTAIN_API_KEY?: string;
  BLUECARE_EXPRESS_API_KEY?: string;
  AQUILINE_API_KEY?: string;
}

export interface ConvertTrackingResult {
  proxyTracking: string;
  proxyCarrier: string;
}

/** Buyer shipping destination — see orders.shipToJson. Optional fields since not every source populates all of them. */
export interface TrackingProxyDestination {
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  /**
   * Origin country to match, for a domestic-looking shipment (US buyer ->
   * US-origin tracking, DE buyer -> DE-origin tracking) regardless of which
   * supplier (Amazon, AliExpress, Temu, ...) actually ships the item — the
   * real fulfillment logistics are irrelevant to what this looks like on
   * paper. Always set to the same value as `country` by the caller
   * (trackingUploader.ts's toProxyDestination) rather than left to each
   * provider to infer. Providers whose search API has no origin filter
   * (TrackCaptain) just ignore this field.
   */
  originCountry?: string;
  /** ISO date (YYYY-MM-DD). */
  deliveryDate?: string;
}

/**
 * Tracking-proxy provider (spec section 7): produces a marketplace-compliant
 * tracking number for a shipment whose real one eBay won't recognize
 * (Amazon Logistics `TBA...`, or an AliExpress/Temu carrier), to avoid Item
 * Not Received (INR) case losses and account-health penalties.
 *
 * `destination` exists because these provider families work completely
 * differently: Bluecare Express/Aquiline (both now dead — see DECISIONS.md)
 * *converted* a given original tracking number 1:1; TrackTaco and
 * TrackCaptain (the live replacements) instead *match* a real carrier
 * tracking number already in their pool by the buyer's ship-to destination
 * — `originalTracking`/`originalCarrier` are irrelevant to them. All shapes
 * fit through one method rather than forking the interface per provider,
 * since every call site just wants "a valid number back," not "how the
 * provider got there."
 */
export interface TrackingProxyClient {
  convertTracking(
    originalTracking: string,
    originalCarrier: string,
    destination?: TrackingProxyDestination,
  ): Promise<ConvertTrackingResult>;
}
