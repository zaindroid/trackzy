import type {
  GeminiDisputeInput,
  GeminiDisputeResult,
  GeminiExtractInput,
  GeminiExtractResult,
  GeminiExtractor,
} from './iface.js';

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
}
