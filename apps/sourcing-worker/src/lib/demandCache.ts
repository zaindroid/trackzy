import { demandCache, type Database } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import type { EbayDemandResult, ScraperEbayClient } from '@fulfillment-tracker/adapters/scraperEbay';
import { now } from './id.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // demand data is stable for ~a week

// Marketing/filler words that don't change what's being searched. Real product
// attributes (silicone, magnetic, 5m, black…) are kept.
const STOPWORDS = new Set(['the', 'a', 'an', 'for', 'with', 'and', 'of', 'to', 'in', 'new', 'best', 'hot', 'premium', 'quality']);

/**
 * Normalize a niche so equivalent phrasings share ONE cache key (and are never
 * paid for twice): lowercase, strip punctuation + filler words, sort tokens.
 * "LED Strip Lights" and "lights led strip" → "led lights strip".
 */
export function normalizeNiche(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return [...new Set(tokens)].sort().join(' ');
}

/**
 * Returns eBay demand for a niche, using the GLOBAL D1 cache when a fresh entry
 * exists (zero ScraperAPI credit) and only calling ScraperAPI on a miss — then
 * persisting the result. The single credit-saving choke point for research.
 */
export async function cachedDemand(
  db: Database,
  research: ScraperEbayClient,
  normalizedKey: string,
  rawKeyword: string,
): Promise<EbayDemandResult> {
  const [row] = await db.select().from(demandCache).where(eq(demandCache.normalizedKey, normalizedKey));
  if (row && now() - row.lastChecked < TTL_MS) {
    return JSON.parse(row.dataJson) as EbayDemandResult;
  }

  const result = await research.searchDemand(rawKeyword);
  const ts = now();
  await db
    .insert(demandCache)
    .values({ normalizedKey, dataJson: JSON.stringify(result), lastChecked: ts })
    .onConflictDoUpdate({ target: demandCache.normalizedKey, set: { dataJson: JSON.stringify(result), lastChecked: ts } });
  return result;
}
