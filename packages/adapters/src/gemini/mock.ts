import { fuzzyTitleSimilarity } from '@fulfillment-tracker/core';
import type {
  ClassifyTrackingExceptionResult,
  GeminiDisputeInput,
  GeminiDisputeResult,
  GeminiExtractInput,
  GeminiExtractResult,
  GeminiExtractor,
  GeminiListingMatchInput,
  GeminiListingMatchResult,
} from './iface.js';

const STUCK_OR_LOST_KEYWORDS = /stuck|lost|missing|returned to sender|damaged|undeliverable|delayed indefinitely/i;
const IN_TRANSIT_KEYWORDS = /transit|moving|departed|arrived at|out for delivery|customs/i;
const DELIVERED_KEYWORDS = /delivered|left at|picked up by (?:customer|recipient)/i;

const EMBEDDING_DIM = 64;

function hashBigram(bigram: string): number {
  let h = 0;
  for (let i = 0; i < bigram.length; i++) h = (h * 31 + bigram.charCodeAt(i)) >>> 0;
  return h % EMBEDDING_DIM;
}

/**
 * Deterministic, hashed-bigram "embedding": similar text shares bigrams and
 * therefore has high cosine similarity, dissimilar text doesn't — a
 * realistic enough stand-in for testing the matching cascade's embedding
 * stage without a live Gemini key.
 */
function mockEmbed(text: string): number[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  const vector = new Array(EMBEDDING_DIM).fill(0) as number[];
  for (let i = 0; i < normalized.length - 1; i++) {
    const bucket = hashBigram(normalized.slice(i, i + 2));
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

/**
 * Deterministic, fixture-free stand-in for the LLM: scans for any
 * carrier-shaped token using the same format patterns the regex parsers
 * understand. This lets "malformed email falls through to Gemini" tests
 * exercise a real success path without needing a live API key, while still
 * failing (low confidence, null candidate) on genuinely unrecognizable text.
 */
const TRACKING_TOKEN = /\b(1Z[0-9A-Z]{16}|JD\d{16,18}|\d{22}|\d{20}|\d{15}|\d{12}|\d{10})\b/;

export class MockGeminiExtractor implements GeminiExtractor {
  async extractTracking(input: GeminiExtractInput): Promise<GeminiExtractResult> {
    const match = input.text.match(TRACKING_TOKEN);
    if (!match) {
      return { candidate: null, confidence: 0.2 };
    }
    return {
      candidate: { trackingNumber: match[1] as string, confidence: 0.95 },
      confidence: 0.95,
    };
  }

  async draftDispute(input: GeminiDisputeInput): Promise<GeminiDisputeResult> {
    return {
      subject: `Tracking inquiry for shipment ${input.trackingNumber}`,
      body: [
        'Hello,',
        '',
        `We are writing regarding shipment ${input.trackingNumber}` +
          (input.carrier ? ` via ${input.carrier}` : '') +
          (input.orderNumber ? ` (order ${input.orderNumber})` : '') +
          '.',
        '',
        `Reason for this inquiry: ${input.reason}`,
        '',
        'Could you please confirm the current status, or process a replacement/refund if the package',
        'cannot be located?',
        '',
        'Thank you,',
        'Fulfillment Tracker',
      ].join('\n'),
    };
  }

  async embedText(text: string): Promise<number[]> {
    return mockEmbed(text);
  }

  async pickBestListingMatch(input: GeminiListingMatchInput): Promise<GeminiListingMatchResult> {
    if (input.candidates.length === 0) {
      return { chosenId: null, confidence: 0 };
    }
    const scored = input.candidates
      .map((c) => ({ id: c.id, score: fuzzyTitleSimilarity(input.targetTitle, c.title) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    // Below this, even the mock's "best guess" is too weak to call a match —
    // mirrors a real LLM declining to force a pick among poor options.
    if (best.score < 0.2) {
      return { chosenId: null, confidence: best.score };
    }
    return { chosenId: best.id, confidence: best.score };
  }

  async classifyTrackingException(rawStatus: string): Promise<ClassifyTrackingExceptionResult> {
    if (STUCK_OR_LOST_KEYWORDS.test(rawStatus)) {
      return { category: 'exception', isStuckOrLost: true };
    }
    if (DELIVERED_KEYWORDS.test(rawStatus)) {
      return { category: 'delivered', isStuckOrLost: false };
    }
    if (IN_TRANSIT_KEYWORDS.test(rawStatus)) {
      return { category: 'in_transit', isStuckOrLost: false };
    }
    return { category: 'needs_review', isStuckOrLost: false };
  }
}
