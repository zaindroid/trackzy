/**
 * Normalizes a product title for comparison: lowercase, strip punctuation,
 * collapse whitespace. Shared by the exact-SKU and fuzzy-title stages of the
 * matching cascade (spec section 8) so both compare on the same basis.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(text: string): string[] {
  const chars = text.replace(/\s+/g, '');
  const result: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) {
    result.push(chars.slice(i, i + 2));
  }
  return result;
}

/**
 * Dice's coefficient (bigram overlap) between two strings, 0..1. Chosen over
 * Levenshtein/Jaro-Winkler because it needs no external dependency, is O(n),
 * and is a well-established, easily-explained similarity measure for
 * short product-title-style strings — appropriate for the spec's "Normalized
 * fuzzy title match ≥ 0.9" cascade stage.
 */
export function diceCoefficient(a: string, b: string): number {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.length === 0 || bigramsB.length === 0) {
    return a === b ? 1 : 0;
  }

  const counts = new Map<string, number>();
  for (const bg of bigramsA) {
    counts.set(bg, (counts.get(bg) ?? 0) + 1);
  }

  let matches = 0;
  for (const bg of bigramsB) {
    const remaining = counts.get(bg) ?? 0;
    if (remaining > 0) {
      matches += 1;
      counts.set(bg, remaining - 1);
    }
  }

  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

/** Normalizes both titles, then scores their similarity. Convenience wrapper around the two primitives above. */
export function fuzzyTitleSimilarity(titleA: string, titleB: string): number {
  return diceCoefficient(normalizeTitle(titleA), normalizeTitle(titleB));
}
