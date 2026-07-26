import { fetchWithBackoff, TokenBucket } from '../rateLimit.js';
import type { EbayMarketResearchClient, EbayMarketResearchEnv, MarketListing, MarketSearchResult, SoldListing, SoldSearchResult } from './iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 10, refillPerSecond: 5 });
}

interface BrowseSearchResponse {
  total?: number;
  itemSummaries?: {
    itemId: string;
    title: string;
    price?: { value: string; currency: string };
    itemWebUrl: string;
    seller?: { username?: string };
    shippingOptions?: { shippingCost?: { value: string } }[];
    condition?: string;
  }[];
}

/**
 * eBay's Browse API (`item_summary/search`) — public, currently-ACTIVE
 * listings only. TODO(HUMAN): request/response shapes here follow eBay's
 * published Browse API docs as closely as possible, same "unverified
 * against a live account" caveat as every other real adapter written
 * without one during this build (see DEPLOY.md) — confirm field names
 * (especially `shippingOptions[].shippingCost`, which some listings may
 * omit entirely for calculated/freight shipping) against a real response.
 */
export class RealEbayMarketResearchClient implements EbayMarketResearchClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: EbayMarketResearchEnv) {}

  /**
   * App-level (client-credentials) OAuth token — a different grant from the
   * per-storefront user tokens the rest of the eBay adapter uses, since this
   * searches eBay's public catalog generally rather than acting on any one
   * connected seller's own orders/inventory. Fetched fresh per call rather
   * than cached: this feature is used interactively (a human typing a
   * keyword), not a tight polling loop, so the extra round-trip is
   * negligible and avoids needing cross-request token-cache infrastructure
   * (KV/Durable Objects) for what's a low-volume feature.
   */
  private async getAppToken(): Promise<string> {
    const basicAuth = btoa(`${this.env.EBAY_CLIENT_ID ?? ''}:${this.env.EBAY_CLIENT_SECRET ?? ''}`);
    const res = await fetchWithBackoff(
      'https://api.ebay.com/identity/v1/oauth2/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
        body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`eBay app-token request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }

  async searchActiveListings(keyword: string, limit = 50): Promise<MarketSearchResult> {
    const token = await this.getAppToken();
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.searchParams.set('q', keyword);
    url.searchParams.set('limit', String(limit));

    const res = await fetchWithBackoff(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': this.env.EBAY_MARKETPLACE_ID ?? 'EBAY_US',
        },
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`eBay Browse API search failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as BrowseSearchResponse;

    const items: MarketListing[] = (data.itemSummaries ?? []).map((item) => ({
      itemId: item.itemId,
      title: item.title,
      priceCents: Math.round(Number.parseFloat(item.price?.value ?? '0') * 100),
      url: item.itemWebUrl,
      sellerUsername: item.seller?.username,
      freeShipping: (item.shippingOptions ?? []).some((s) => Number.parseFloat(s.shippingCost?.value ?? '1') === 0),
      condition: item.condition,
    }));

    return { totalListings: data.total ?? items.length, items };
  }

  /**
   * Real sold/completed listing data via an Apify actor (see iface.ts
   * docstring for why: eBay's own Marketplace Insights API is gated behind
   * an approval this app doesn't have). Confirmed live against a real
   * account: the first two candidate actors tried (`automation-lab/ebay-sold-scraper`,
   * `midwest_united/ebay-sold-comps`) came back empty even for
   * high-volume terms like "nintendo switch console" — one logged an
   * explicit Akamai bot-challenge hit, both are low-usage/less-maintained.
   * `caffein.dev/ebay-sold-scraper` (301k+ runs, ~99.6% success rate, built
   * as recently as this week) returned real data reliably — this is the
   * one actually wired up here. Input is `{keywords: [keyword], count}` (an
   * array even for one keyword — that's this actor's shape, not a
   * generalization on our part). Output field names below (`soldPrice` as a
   * numeric-string, `endedAt`, `sellerUsername`, `shippingType`,
   * `bidCount`) are confirmed live, not guessed. Note `sellerUsername` came
   * back `null` on every real result observed — this actor doesn't reliably
   * expose seller identity, so `uniqueSellers` computed from this data will
   * likely undercount competition; treat that specific signal with caution
   * until confirmed otherwise.
   */
  async searchSoldListings(keyword: string, maxItems = 60): Promise<SoldSearchResult> {
    const actorId = this.env.APIFY_EBAY_SOLD_ACTOR_ID ?? 'caffein.dev~ebay-sold-listings';
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(this.env.APIFY_TOKEN ?? '')}`;

    const res = await fetchWithBackoff(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords: [keyword], count: maxItems }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Apify eBay sold-listings actor failed: ${res.status} ${await res.text()}`);
    }
    const rawItems = (await res.json()) as Record<string, unknown>[];

    const items: SoldListing[] = rawItems.map((raw) => ({
      itemId: String(raw.itemId ?? ''),
      title: String(raw.title ?? ''),
      soldPriceCents: Math.round(Number(raw.soldPrice ?? 0) * 100),
      soldDate: String(raw.endedAt ?? ''),
      sellerUsername: raw.sellerUsername ? String(raw.sellerUsername) : undefined,
      freeShipping: raw.shippingType === 'free' || Number(raw.shippingPrice ?? 1) === 0,
      condition: raw.condition ? String(raw.condition) : undefined,
      bidsCount: raw.bidCount !== undefined && raw.bidCount !== null ? Number(raw.bidCount) : undefined,
      url: String(raw.url ?? ''),
    }));

    return { items };
  }
}
