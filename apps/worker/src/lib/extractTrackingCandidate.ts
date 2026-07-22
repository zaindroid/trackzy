import { getParser, REGEX_CONFIDENCE_THRESHOLD, type TrackingCandidate } from '@fulfillment-tracker/core';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { Env } from '../env.js';

export interface ExtractTrackingCandidateResult {
  candidate: TrackingCandidate | null;
  source: 'regex' | 'gemini';
  error: string | null;
}

/**
 * Regex-parser-first, Gemini-fallback tracking extraction — shared by both
 * inbound-email ingestion (email.ts) and Gmail-poll ingestion
 * (gmailIngestion.ts), since both need exactly the same "try the supplier's
 * registered parser, fall back to Gemini only below the confidence
 * threshold" logic (spec 6b). Pulled out of email.ts in Phase 2 milestone 5
 * specifically so Gmail ingestion doesn't duplicate it.
 */
export async function extractTrackingCandidate(input: {
  env: Env;
  subject: string;
  text: string;
  supplierName?: string;
  parserId?: string;
}): Promise<ExtractTrackingCandidateResult> {
  if (input.parserId) {
    const parser = getParser(input.parserId);
    const parseResult = parser?.({ subject: input.subject, text: input.text });
    if (parseResult && parseResult.confidence >= REGEX_CONFIDENCE_THRESHOLD && parseResult.candidate) {
      return { candidate: parseResult.candidate, source: 'regex', error: null };
    }
  }

  const gemini = createGeminiExtractor(input.env);
  const geminiResult = await gemini.extractTracking({
    subject: input.subject,
    text: input.text,
    supplierName: input.supplierName,
  });
  if (geminiResult.confidence >= REGEX_CONFIDENCE_THRESHOLD && geminiResult.candidate) {
    return { candidate: geminiResult.candidate, source: 'gemini', error: null };
  }

  const error = input.parserId
    ? `Parser '${input.parserId}' did not match; Gemini fallback confidence ${geminiResult.confidence.toFixed(2)} (< ${REGEX_CONFIDENCE_THRESHOLD} threshold)`
    : `No supplier matched sender address; Gemini fallback confidence ${geminiResult.confidence.toFixed(2)} (< ${REGEX_CONFIDENCE_THRESHOLD} threshold)`;
  return { candidate: null, source: 'gemini', error };
}
