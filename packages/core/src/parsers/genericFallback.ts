import type { EmailParseInput, EmailParseResult } from './types.js';

/**
 * Placeholder parser for suppliers with no dedicated regex format yet (CJ
 * Dropshipping, Temu — see DECISIONS.md's multi-tenant connections entry).
 * Always reports zero confidence, which is exactly what forces every email
 * from that supplier through the Gemini classification fallback
 * (`extractTrackingCandidate`, spec 6b step 4) instead of silently matching
 * nothing. Exists only so `suppliers.parserId` has something valid to point
 * at — the real extraction work happens in Gemini, not here.
 */
export function parseGenericFallback(_input: EmailParseInput): EmailParseResult {
  return { candidate: null, confidence: 0 };
}
