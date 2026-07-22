import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { ConvertTrackingResult, TrackingProxyClient, TrackingProxyEnv } from '../iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 2 });
}

/**
 * Aquiline tracking-proxy API — an alternate provider to Bluecare Express
 * (spec 7 names both as acceptable options). Snake_case field naming here is
 * deliberately different from Bluecare Express's camelCase to reflect that
 * these are two independent third-party vendors, not the same API under a
 * different name. TODO(HUMAN): verify against Aquiline's actual API docs
 * once an account exists — see DEPLOY.md.
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
