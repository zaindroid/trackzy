import type { TrackingCandidate } from '@fulfillment-tracker/core';

export interface GeminiEnv {
  MOCK_MODE?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
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

/**
 * The ONLY two call sites for the LLM anywhere in this codebase (hard
 * architectural rule — never call Gemini from the margin/pricing/money path).
 */
export interface GeminiExtractor {
  extractTracking(input: GeminiExtractInput): Promise<GeminiExtractResult>;
  draftDispute(input: GeminiDisputeInput): Promise<GeminiDisputeResult>;
}
