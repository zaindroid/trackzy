// VeRO (eBay Verified Rights Owner) screening — keeps IP-infringing products OUT
// of the sourcing funnel BEFORE they're scored, surfaced, or listed. Listing
// branded / trademarked / counterfeit-risk items is the single biggest cause of
// eBay seller account suspensions, so a sourcing bot that surfaces them is
// actively harmful to the seller. We screen the niche keyword AND the matched
// supplier product title, and only clean products proceed to scoring.
//
// This is a deliberately CONSERVATIVE, HAND-CURATED blocklist: brands that
// actively file VeRO takedowns across the top dropshipping categories, plus
// generic counterfeit-intent phrases. Pure + deterministic (no network / LLM) so
// it runs cheaply on the hot path and is fully unit-tested. It is a floor, not a
// guarantee — expand the lists as new infringing niches are observed, and pair
// with the seller's own judgement.

// Brand marks (single- and multi-word). Matched case-insensitively on WORD
// BOUNDARIES, so "gucci" hits but a brand token buried inside an unrelated word
// does not. Multi-word marks ("louis vuitton") match only as the full phrase.
export const VERO_BRAND_TERMS: readonly string[] = [
  // Luxury / fashion houses
  'louis vuitton', 'lv', 'gucci', 'chanel', 'prada', 'hermes', 'burberry', 'versace', 'balenciaga',
  'dior', 'fendi', 'givenchy', 'ysl', 'saint laurent', 'rolex', 'cartier', 'tiffany', 'swarovski',
  'ray ban', 'rayban', 'oakley', 'coach', 'michael kors', 'kate spade', 'pandora',
  // Sportswear / footwear
  'nike', 'adidas', 'jordan', 'air jordan', 'yeezy', 'puma', 'reebok', 'new balance', 'under armour',
  'north face', 'supreme', 'lululemon', 'vans', 'converse', 'crocs',
  // Electronics
  'apple', 'iphone', 'ipad', 'airpods', 'macbook', 'airtag', 'samsung', 'galaxy', 'sony',
  'playstation', 'ps5', 'xbox', 'nintendo', 'bose', 'beats', 'gopro', 'dyson', 'anker',
  // Entertainment / characters (Disney et al. are extremely aggressive)
  'disney', 'pixar', 'marvel', 'star wars', 'mickey mouse', 'frozen', 'harry potter', 'pokemon',
  'pokémon', 'hello kitty', 'sanrio', 'sonic', 'super mario', 'spiderman', 'spider man', 'batman',
  'superman', 'dc comics', 'minecraft', 'fortnite', 'lego', 'barbie', 'hot wheels', 'funko',
  // Auto
  'bmw', 'mercedes', 'audi', 'toyota', 'honda', 'ford', 'tesla', 'ferrari', 'lamborghini', 'porsche',
  // Beauty / lifestyle
  'mac cosmetics', 'kylie cosmetics', 'fenty', 'stanley cup', 'yeti', 'owala',
];

// Generic phrases that signal counterfeit / replica intent regardless of brand.
export const VERO_RISK_PHRASES: readonly string[] = [
  'replica', 'counterfeit', 'knockoff', 'knock off', 'bootleg', '1 1', 'aaa quality', 'mirror quality',
  'inspired by', 'style of', 'oem for', 'dupe',
];

export interface VeroScreenResult {
  blocked: boolean;
  matchedTerm?: string;
  reason?: 'brand' | 'risk-phrase';
}

/** Space-pad + collapse to non-alphanumeric-delimited tokens, so substring
 * checks against similarly-normalized terms behave as whole-word matches. */
function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')} `;
}

/**
 * Screens a piece of text (a niche keyword or supplier product title) for VeRO /
 * counterfeit risk. Returns `{ blocked: true, matchedTerm, reason }` on the first
 * match (risk phrases checked before brands), else `{ blocked: false }`.
 */
export function screenVero(text: string): VeroScreenResult {
  const t = normalize(text);
  for (const term of VERO_RISK_PHRASES) {
    if (t.includes(normalize(term))) return { blocked: true, matchedTerm: term, reason: 'risk-phrase' };
  }
  for (const term of VERO_BRAND_TERMS) {
    if (t.includes(normalize(term))) return { blocked: true, matchedTerm: term, reason: 'brand' };
  }
  return { blocked: false };
}
