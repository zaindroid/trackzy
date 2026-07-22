import type { TrackingCandidate } from '@fulfillment-tracker/core';

export interface GeminiEnv {
  MOCK_MODE?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_EMBEDDING_MODEL?: string;
}

export interface GeminiExtractInput {
  subject: string;
  text: string;
  supplierName?: string;
}

export interface GeminiExtractResult {
  candidate: TrackingCandidate | null;
  confidence: number;
}

export interface GeminiDisputeInput {
  reason: string;
  trackingNumber: string;
  carrier?: string | null;
  orderNumber?: string;
}

export interface GeminiDisputeResult {
  subject: string;
  body: string;
}

export interface GeminiListingMatchCandidate {
  id: string;
  title: string;
}

export interface GeminiListingMatchInput {
  targetTitle: string;
  candidates: GeminiListingMatchCandidate[];
}

export interface GeminiListingMatchResult {
  chosenId: string | null;
  confidence: number;
}

/**
 * The ONLY four call sites for the LLM anywhere in this codebase (hard
 * architectural rule — never call Gemini from the margin/pricing/repricing/
 * money path): email-extraction fallback, dispute drafting, SKU/listing
 * matching (ambiguous cases only — after exact-SKU, fuzzy-title, and
 * embedding-similarity have all failed to produce an unambiguous match; see
 * packages/core/src/matching.ts), and carrier exception triage.
 */
export interface GeminiExtractor {
  extractTracking(input: GeminiExtractInput): Promise<GeminiExtractResult>;
  draftDispute(input: GeminiDisputeInput): Promise<GeminiDisputeResult>;
  /** Text embedding, used only as the third (pre-LLM) stage of the SKU/listing matching cascade. */
  embedText(text: string): Promise<number[]>;
  /** Constrained to picking from the provided candidate list (or none) — never a free-text answer. */
  pickBestListingMatch(input: GeminiListingMatchInput): Promise<GeminiListingMatchResult>;
}
