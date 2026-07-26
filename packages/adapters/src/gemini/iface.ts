import type { TrackingCandidate } from '@fulfillment-tracker/core';

/**
 * Despite the name, only `embedText` actually calls Gemini now — every other
 * method (the five chat/JSON call sites) runs on Groq instead, after
 * Gemini's free-tier `generate_content` quota (20 requests/day) turned out
 * to be too tight for even light production use (see DECISIONS.md). Kept
 * the `Gemini*` names rather than renaming the whole interface/factory,
 * since dozens of call sites across the codebase import
 * `createGeminiExtractor`/`GeminiExtractor` and a rename would be pure
 * churn for no behavior change. Groq has no embeddings API at all, so
 * `embedText` — the one method genuinely unrelated to "generate JSON from a
 * prompt" — stays on Gemini, whose `embedContent` quota is tracked
 * separately from `generate_content` and wasn't exhausted.
 */
export interface GeminiEnv {
  MOCK_MODE?: string;
  GEMINI_API_KEY?: string;
  GEMINI_EMBEDDING_MODEL?: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
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

export type TrackingExceptionCategory = 'in_transit' | 'delivered' | 'exception' | 'needs_review';

export interface ClassifyTrackingExceptionResult {
  category: TrackingExceptionCategory;
  /** True for statuses indicating the shipment is stuck or likely lost — triggers DisputeWorkflow. */
  isStuckOrLost: boolean;
}

export interface GeminiTitleSuggestionInput {
  currentTitle: string;
  category?: string;
  keyFeatures?: string[];
}

export interface GeminiTitleSuggestionResult {
  suggestedTitle: string;
  reasoning: string;
}

export interface RefineKeywordsInput {
  seedKeyword: string;
  currentScore: number;
  sampleTitles: string[];
}

export interface ExpandNichesInput {
  seed: string;
  /** How many distinct sub-niches to generate (the pipeline explores each). */
  count: number;
}

export interface OpportunityAnalysisInput {
  keyword: string;
  avgPriceCents: number;
  totalSold: number;
  uniqueSellers: number;
  freeShippingPercent: number;
}

export interface OpportunityAnalysisResult {
  verdict: string;
  sellPriceMinCents: number;
  sellPriceMaxCents: number;
  targetSourcePriceCents: number;
  marginEstimateCents: number;
  risk: string;
  recommendedKeywords: string[];
}

export interface ListingContentInput {
  keyword: string;
  supplierTitle: string;
  avgSoldPriceCents: number;
}

export interface ListingContentResult {
  /** eBay-search-optimized title, kept under eBay's 80-char limit. */
  title: string;
  /** HTML description body (safe subset — headings, paragraphs, lists). */
  descriptionHtml: string;
  /** Item specifics / eBay aspects, e.g. { Brand: 'Generic', Type: 'Sleep Mask' }. */
  aspects: Record<string, string>;
}

/**
 * The seven call sites for the LLM anywhere in this codebase (hard
 * architectural rule — never call Gemini/Groq from the margin/pricing/
 * repricing/money path — see below for why the two newest ones don't
 * violate that): email-extraction fallback, dispute drafting, SKU/listing
 * matching (ambiguous cases only — after exact-SKU, fuzzy-title, and
 * embedding-similarity have all failed to produce an unambiguous match; see
 * packages/core/src/matching.ts), carrier exception triage (ambiguous cases
 * only — after the deterministic 17TRACK status map in webhooks.tracking.ts
 * has failed to recognize the raw carrier status text), listing title
 * optimization (`suggestListingTitle` — the fifth site, added post-build at
 * the user's explicit request/authorization — never touches price/margin/
 * stock, only suggests copy a human reviews before applying), and two more
 * added for product-discovery research (`suggestRefinedKeywords`,
 * `analyzeOpportunity`), and one for the sourcing portal's listing generation
 * (`generateListingContent` — title/description/aspects for a product a human
 * reviews and one-click publishes; see the plan) — see DECISIONS.md: these
 * all run entirely in the *pre-listing* research/authoring phase, before any
 * product is sourced or listed — there is no order, no margin calculation, no
 * money committed anywhere in this path, so the "never in the margin/money
 * path" rule is about a different phase of the pipeline than these operate in,
 * not an exception to it.
 */
export interface GeminiExtractor {
  extractTracking(input: GeminiExtractInput): Promise<GeminiExtractResult>;
  draftDispute(input: GeminiDisputeInput): Promise<GeminiDisputeResult>;
  /** Text embedding, used only as the third (pre-LLM) stage of the SKU/listing matching cascade. */
  embedText(text: string): Promise<number[]>;
  /** Constrained to picking from the provided candidate list (or none) — never a free-text answer. */
  pickBestListingMatch(input: GeminiListingMatchInput): Promise<GeminiListingMatchResult>;
  /** Constrained to the same four-value status vocabulary every deterministic carrier status maps to. */
  classifyTrackingException(rawStatus: string): Promise<ClassifyTrackingExceptionResult>;
  /** Suggests a marketplace-search-optimized title; never auto-applied — see routes/api/listings.ts. */
  suggestListingTitle(input: GeminiTitleSuggestionInput): Promise<GeminiTitleSuggestionResult>;
  /** Product-discovery "deep search" step: generates more specific sub-keywords when a scan's score is too low to be worth listing. */
  suggestRefinedKeywords(input: RefineKeywordsInput): Promise<string[]>;
  /** Sourcing "deep search": from one seed, generate many VARIED, specific sub-niches (materials, use-cases, audiences, bundles, adjacent products) to widen the range of candidates explored in a single research run. */
  expandNiches(input: ExpandNichesInput): Promise<string[]>;
  /** Product-discovery final analysis: a human-readable verdict on the winning keyword from a deep search — never auto-acted on. */
  analyzeOpportunity(input: OpportunityAnalysisInput): Promise<OpportunityAnalysisResult>;
  /** Sourcing portal: generates eBay title/description/aspects for a candidate — a human reviews and one-click publishes. */
  generateListingContent(input: ListingContentInput): Promise<ListingContentResult>;
}
