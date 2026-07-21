import type { TrackingCandidate } from '../types.js';

export interface EmailParseInput {
  subject: string;
  text: string;
}

export interface EmailParseResult {
  candidate: TrackingCandidate | null;
  /** 0..1. Regex parsers return 1 on a full pattern match, 0 when nothing matched. */
  confidence: number;
}

export type EmailParser = (input: EmailParseInput) => EmailParseResult;

/** Confidence below this triggers the Gemini fallback (see spec 6b step 4). */
export const REGEX_CONFIDENCE_THRESHOLD = 0.8;
