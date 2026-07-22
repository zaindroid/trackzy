import type { ConvertTrackingResult, TrackingProxyClient } from '../iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic mock matching spec 7's literal example format: "BCE<random>". */
export class MockBluecareExpressClient implements TrackingProxyClient {
  async convertTracking(originalTracking: string, _originalCarrier: string): Promise<ConvertTrackingResult> {
    const suffix = hashString(originalTracking).toString(16).toUpperCase().padStart(10, '0').slice(0, 10);
    return { proxyTracking: `BCE${suffix}`, proxyCarrier: 'bluecare_express' };
  }
}
