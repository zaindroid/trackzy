import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { ConvertTrackingResult, TrackingProxyClient, TrackingProxyEnv } from '../iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 2 });
}

/**
 * Bluecare Express tracking-proxy API. Endpoint shape follows the general
 * REST convention every other real adapter in this codebase uses (POST JSON,
 * bearer auth); TODO(HUMAN): verify the exact path and field names against
 * Bluecare Express's actual API docs once an account exists — see DEPLOY.md.
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
