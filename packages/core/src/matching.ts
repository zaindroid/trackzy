import { fuzzyTitleSimilarity } from './fuzzyMatch.js';

export type MatchSource = 'exact_sku' | 'fuzzy_title' | 'embedding' | 'llm';

export interface MatchCandidate {
  supplierProductId: string;
  title: string;
  sku?: string;
}

export interface MatchResult {
  supplierProductId: string | null;
  confidence: number;
  source: MatchSource | null;
}

const FUZZY_TITLE_THRESHOLD = 0.9;
const EMBEDDING_THRESHOLD = 0.85;
/** Two candidates are "too close to call" when their scores differ by less than this. */
const AMBIGUITY_MARGIN = 0.03;

function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/**
 * SKU/listing matching cascade (spec section 8): exact SKU, then normalized
 * fuzzy title (≥ 0.9), then embedding similarity, stopping at the first
 * stage that produces an unambiguous winner. Pure and synchronous — it does
 * not call Gemini's embedding API itself (that's an adapter/worker-layer
 * concern, since `packages/core` has zero Cloudflare/network dependencies);
 * callers that reach this deep pass in already-computed embedding
 * similarities. The final "ambiguous LLM" stage (spec: "Gemini Flash
 * constrained to picking from a provided top-5 list") is likewise not run
 * here — this function's job is only to decide *whether* the cascade needs
 * to escalate to it, returning `null` when nothing here resolved the match.
 */
export function matchByExactSkuOrFuzzyTitle(
  listing: { sku: string; title: string },
  candidates: MatchCandidate[],
): MatchResult | null {
  const skuMatches = candidates.filter((c) => c.sku && normalizeSku(c.sku) === normalizeSku(listing.sku));
  if (skuMatches.length === 1) {
    return { supplierProductId: skuMatches[0]!.supplierProductId, confidence: 1, source: 'exact_sku' };
  }

  const scored = candidates
    .map((c) => ({ candidate: c, score: fuzzyTitleSimilarity(listing.title, c.title) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];
  if (best && best.score >= FUZZY_TITLE_THRESHOLD && (!runnerUp || best.score - runnerUp.score >= AMBIGUITY_MARGIN)) {
    return { supplierProductId: best.candidate.supplierProductId, confidence: best.score, source: 'fuzzy_title' };
  }

  return null;
}

export interface EmbeddingScoredCandidate {
  candidate: MatchCandidate;
  similarity: number;
}

/**
 * Second cascade stage, given similarities already computed by the caller
 * (via Gemini's embedding API — see packages/adapters/src/gemini). Same
 * "clear unambiguous winner" logic as the fuzzy-title stage.
 */
export function matchByEmbedding(scored: EmbeddingScoredCandidate[]): MatchResult | null {
  const sorted = [...scored].sort((a, b) => b.similarity - a.similarity);
  const best = sorted[0];
  const runnerUp = sorted[1];
  if (best && best.similarity >= EMBEDDING_THRESHOLD && (!runnerUp || best.similarity - runnerUp.similarity >= AMBIGUITY_MARGIN)) {
    return { supplierProductId: best.candidate.supplierProductId, confidence: best.similarity, source: 'embedding' };
  }
  return null;
}

/** The top-N candidates (by embedding similarity) to hand to the final LLM disambiguation stage. */
export function topCandidatesForLlm(scored: EmbeddingScoredCandidate[], limit = 5): MatchCandidate[] {
  return [...scored]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map((s) => s.candidate);
}
