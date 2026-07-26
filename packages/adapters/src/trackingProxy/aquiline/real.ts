import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { ConvertTrackingResult, TrackingProxyClient, TrackingProxyEnv } from '../iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 2 });
}

/**
 * DEAD PROVIDER — DO NOT WIRE THIS INTO PRODUCTION TRAFFIC. eBay removed
 * Aquiline from its accepted carrier list (2024–2025, same crackdown as
 * Bluecare Express); uploading its output now gets policy defects (MC011),
 * not protection from them. Kept only as a reference implementation /
 * mock-parity fixture — see DECISIONS.md and DEPLOY.md section 14.
 * `apps/worker/src/trackingUploader.ts` never calls this class; real
 * conversion now goes through the manual TrackCaptain-claim queue instead.
 */
export class RealAquilineClient implements TrackingProxyClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: TrackingProxyEnv) {}

  async convertTracking(originalTracking: string, originalCarrier: string): Promise<ConvertTrackingResult> {
    const res = await fetchWithBackoff(
      'https://api.aquiline.io/v1/convert-tracking',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': this.env.AQUILINE_API_KEY ?? '',
        },
        body: JSON.stringify({ tracking_number: originalTracking, carrier: originalCarrier }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Aquiline tracking conversion failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { proxy_tracking_number: string; proxy_carrier: string };
    return { proxyTracking: data.proxy_tracking_number, proxyCarrier: data.proxy_carrier };
  }
}
