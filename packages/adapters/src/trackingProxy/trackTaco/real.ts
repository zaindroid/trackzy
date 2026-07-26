import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { ConvertTrackingResult, TrackingProxyClient, TrackingProxyDestination, TrackingProxyEnv } from '../iface.js';

const BASE_URL = 'https://v2.tracktaco.com';
// Candidates fetched per search — small enough to keep credit spend to
// exactly 1 in the common case, large enough that a same-instant "someone
// else revealed it first" race (docs call this out as an expected outcome)
// can just move to the next candidate instead of failing outright.
const CANDIDATE_PAGE_SIZE = 5;

function newBucket(): TokenBucket {
  // Most restrictive relevant limit is /v2/tns/reveal at 3/sec.
  return new TokenBucket({ capacity: 6, refillPerSecond: 3 });
}

interface TrackTacoErrorBody {
  error: { code: string; message: string; doc_url?: string; request_id?: string };
}

interface SearchResultItem {
  tn_id: string;
  carrier: 'fedex' | 'ups' | 'dhl';
}

interface SearchResponse {
  searches: { results: SearchResultItem[]; next_cursor: string | null; total: number; error?: { code: string; message: string } }[];
}

interface RevealResultItem {
  tn_id: string;
  outcome: 'revealed' | 'already_revealed' | 'not_found' | 'insufficient_credits' | 'internal';
  tracking_number?: string;
  carrier?: 'fedex' | 'ups' | 'dhl';
  error?: { code: string; message: string };
}

interface RevealResponse {
  results: RevealResultItem[];
  credits_remaining: number;
}

const CARRIER_LABEL: Record<'fedex' | 'ups' | 'dhl', string> = { fedex: 'FedEx', ups: 'UPS', dhl: 'DHL' };

/**
 * TrackTaco's real, documented v2 REST API (confirmed against their live
 * public API docs, 2026-07). Unlike TrackCaptain's single atomic
 * match-and-claim, TrackTaco splits into two calls: `POST /v2/tns/search`
 * (free, filter by destination, returns candidate `tn_id`s with no credit
 * spent) then `POST /v2/tns/reveal` (1 credit per successfully revealed id,
 * returns the real tracking number). Fetches a small batch of candidates
 * and reveals the first one that isn't already claimed by another customer
 * — `already_revealed` is a named, expected outcome in their own docs, not
 * an error condition worth failing the whole attempt over.
 */
export class RealTrackTacoClient implements TrackingProxyClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: TrackingProxyEnv) {}

  private authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.TRACKTACO_API_KEY ?? ''}` };
  }

  async convertTracking(
    _originalTracking: string,
    _originalCarrier: string,
    destination?: TrackingProxyDestination,
  ): Promise<ConvertTrackingResult> {
    const searchRes = await fetchWithBackoff(
      `${BASE_URL}/v2/tns/search`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          searches: [
            {
              filter: {
                dest: { country: destination?.country, state: destination?.state, city: destination?.city },
                // Domestic-looking match — see TrackingProxyDestination.originCountry's doc comment.
                origin: destination?.originCountry ? { country: destination.originCountry } : undefined,
              },
              page_size: CANDIDATE_PAGE_SIZE,
            },
          ],
        }),
      },
      this.bucket,
    );
    if (!searchRes.ok) {
      throw new Error(`TrackTaco search failed: ${searchRes.status} ${await errorMessage(searchRes)}`);
    }
    const searchBody = (await searchRes.json()) as SearchResponse;
    const search = searchBody.searches[0];
    if (search?.error) {
      throw new Error(`TrackTaco search query error: ${search.error.code} ${search.error.message}`);
    }
    const candidates = search?.results ?? [];
    if (candidates.length === 0) {
      throw new Error('TrackTaco search returned no candidates for this destination');
    }

    const revealRes = await fetchWithBackoff(
      `${BASE_URL}/v2/tns/reveal`,
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({ tn_ids: candidates.map((c) => c.tn_id) }),
      },
      this.bucket,
    );
    if (!revealRes.ok) {
      throw new Error(`TrackTaco reveal failed: ${revealRes.status} ${await errorMessage(revealRes)}`);
    }
    const revealBody = (await revealRes.json()) as RevealResponse;

    const revealed = revealBody.results.find((r) => r.outcome === 'revealed');
    if (revealed?.tracking_number && revealed.carrier) {
      return { proxyTracking: revealed.tracking_number, proxyCarrier: CARRIER_LABEL[revealed.carrier] };
    }

    // Every candidate failed (all already claimed, insufficient credits, etc).
    const firstFailure = revealBody.results[0];
    throw new Error(
      `TrackTaco reveal produced no usable tracking number (${revealBody.results.length} candidates tried): ${firstFailure?.outcome ?? 'unknown'} ${firstFailure?.error?.message ?? ''}`,
    );
  }
}

async function errorMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as TrackTacoErrorBody;
    return parsed.error?.message ?? text;
  } catch {
    return text;
  }
}
