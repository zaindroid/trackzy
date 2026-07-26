import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { ConvertTrackingResult, TrackingProxyClient, TrackingProxyDestination, TrackingProxyEnv } from '../iface.js';

function newBucket(): TokenBucket {
  // TrackCaptain's most restrictive relevant limit is 60 req/min on match-and-claim.
  return new TokenBucket({ capacity: 10, refillPerSecond: 1 });
}

interface MatchAndClaimResponse {
  tracking_number: string;
  carrier: string;
}

interface TrackCaptainErrorResponse {
  error: string;
  credit_balance?: number;
}

/**
 * TrackCaptain's real, documented REST API (confirmed against their live
 * public API docs, 2026-07 — unlike Bluecare Express/Aquiline, which were
 * both written against inference before being confirmed dead; see
 * DECISIONS.md). `POST /tracking/match-and-claim` is the one-shot endpoint
 * their own docs recommend for exactly our case ("resellers whose customers
 * don't browse — they just need a number for an order"): matches a real
 * carrier tracking number by ship-to destination and claims it atomically,
 * 1 credit, no wasted spend on a race with another claimant.
 *
 * `originalTracking`/`originalCarrier` are unused — TrackCaptain has no
 * concept of "convert this specific number," only "give me any number
 * matching this destination" (see the interface doc comment for why the
 * signature still carries them).
 */
export class RealTrackCaptainClient implements TrackingProxyClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: TrackingProxyEnv) {}

  async convertTracking(
    _originalTracking: string,
    _originalCarrier: string,
    destination?: TrackingProxyDestination,
  ): Promise<ConvertTrackingResult> {
    const res = await fetchWithBackoff(
      'https://trackcaptain.com/api/v1/tracking/match-and-claim',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.TRACKCAPTAIN_API_KEY ?? ''}`,
        },
        body: JSON.stringify({
          city: destination?.city,
          state: destination?.state,
          zip: destination?.zip,
          country: destination?.country,
          delivery_date: destination?.deliveryDate,
        }),
      },
      this.bucket,
    );
    if (!res.ok) {
      const bodyText = await res.text();
      const parsed = safeJsonParse<TrackCaptainErrorResponse>(bodyText);
      throw new Error(`TrackCaptain match-and-claim failed: ${res.status} ${parsed?.error ?? bodyText}`);
    }
    const data = (await res.json()) as MatchAndClaimResponse;
    return { proxyTracking: data.tracking_number, proxyCarrier: data.carrier };
  }
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
