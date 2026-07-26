import { config } from './config.js';
import type { EbayActiveSignal } from './types.js';

let cachedToken: { token: string; expiresAt: number } | null = null;

/** eBay application (client-credentials) OAuth token — no user login needed for
 * the Browse API. Cached until shortly before expiry. */
async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const basic = Buffer.from(`${config.ebayClientId}:${config.ebayClientSecret}`).toString('base64');
  const res = await fetch(`${config.ebayApiBase}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
  });
  if (!res.ok) throw new Error(`eBay OAuth failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/**
 * Active-listing signal for a niche via the eBay Browse API. `total` is eBay's
 * full count of competing active listings; prices come from the sampled page.
 * Browse is free with any keyset and NOT anti-bot walled (unlike scraping).
 */
export async function fetchEbayActive(keyword: string): Promise<EbayActiveSignal | null> {
  const token = await getAppToken();
  const url = new URL(`${config.ebayApiBase}/buy/browse/v1/item_summary/search`);
  url.searchParams.set('q', keyword);
  url.searchParams.set('limit', String(config.sampleLimit));
  url.searchParams.set('filter', 'buyingOptions:{FIXED_PRICE}');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': config.ebayMarketplaceId },
  });
  if (!res.ok) throw new Error(`eBay Browse failed for "${keyword}": ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    total?: number;
    itemSummaries?: { title?: string; image?: { imageUrl?: string }; price?: { value?: string } }[];
  };

  const items = data.itemSummaries ?? [];
  if (items.length === 0) return null;

  const priceCents = items
    .map((i) => Math.round(Number(i.price?.value ?? '0') * 100))
    .filter((c) => c > 0);
  const first = items[0]!;

  return {
    activeCount: data.total ?? items.length,
    medianPriceCents: median(priceCents),
    sampleTitle: first.title ?? keyword,
    sampleImageUrl: first.image?.imageUrl,
  };
}
