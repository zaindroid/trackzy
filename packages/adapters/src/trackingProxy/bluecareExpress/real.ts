import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { ConvertTrackingResult, TrackingProxyClient, TrackingProxyEnv } from '../iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 2 });
}

/**
 * DEAD PROVIDER — DO NOT WIRE THIS INTO PRODUCTION TRAFFIC. eBay removed
 * Bluecare Express from its accepted carrier list (announced mid-2024,
 * actively enforced through 2025 into 2026); uploading its output now gets
 * policy defects (MC011) on every affected order, not protection from them.
 * Kept only as a reference implementation / mock-parity fixture — see
 * DECISIONS.md and DEPLOY.md section 14. `apps/worker/src/trackingUploader.ts`
 * never calls this class; real conversion now goes through the manual
 * TrackCaptain-claim queue instead (no provider in this space currently
 * offers a real API — see DECISIONS.md for what was researched).
 */
export class RealBluecareExpressClient implements TrackingProxyClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: TrackingProxyEnv) {}

  async convertTracking(originalTracking: string, originalCarrier: string): Promise<ConvertTrackingResult> {
    const res = await fetchWithBackoff(
      'https://api.bluecareexpress.com/v1/tracking/convert',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.BLUECARE_EXPRESS_API_KEY ?? ''}`,
        },
        body: JSON.stringify({ trackingNumber: originalTracking, carrier: originalCarrier }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Bluecare Express tracking conversion failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { proxyTrackingNumber: string; proxyCarrier: string };
    return { proxyTracking: data.proxyTrackingNumber, proxyCarrier: data.proxyCarrier };
  }
}
