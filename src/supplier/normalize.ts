// Marketing / filler tokens that add no sourcing meaning. Real product
// attributes (clear, magnetic, silicone, 5m, black…) are deliberately KEPT.
const STOPWORDS = new Set([
  'new', 'hot', 'sale', 'best', 'top', 'premium', 'quality', 'genuine', 'original',
  'free', 'shipping', 'ship', 'fast', 'deal', 'deals', 'offer', 'brand',
  'for', 'the', 'a', 'an', 'with', 'and', 'of', 'to', 'in', 'by',
  'pcs', 'pc', 'pack', 'lot', 'set', 'bundle', 'wholesale', 'dropshipping',
  'uk', 'us', 'usa', 'eu', 'ebay',
]);

/**
 * Normalize a supplier query so equivalent phrasings collapse to ONE cache key
 * (and are never paid for twice in a run): lowercase, strip punctuation, drop
 * marketing/filler words, then sort the remaining tokens. So
 * "iPhone 15 Case Clear" and "clear case iphone 15" both become
 * "15 case clear iphone".
 */
export function normalizeQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return [...new Set(tokens)].sort().join(' ');
}
