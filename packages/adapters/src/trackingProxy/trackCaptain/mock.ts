import type { ConvertTrackingResult, TrackingProxyClient, TrackingProxyDestination } from '../iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic mock — "TC<hash>" makes which provider ran obvious from the stored value alone, same convention as the other mocks. */
export class MockTrackCaptainClient implements TrackingProxyClient {
  async convertTracking(
    originalTracking: string,
    _originalCarrier: string,
    destination?: TrackingProxyDestination,
  ): Promise<ConvertTrackingResult> {
    const seed = `${originalTracking}:${destination?.zip ?? ''}:${destination?.state ?? ''}`;
    const suffix = hashString(seed).toString(16).toUpperCase().padStart(10, '0').slice(0, 10);
    return { proxyTracking: `TC${suffix}`, proxyCarrier: 'FedEx' };
  }
}
