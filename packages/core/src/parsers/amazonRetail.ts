import type { EmailParseInput, EmailParseResult } from './types.js';

/**
 * Amazon Retail order-shipped confirmation format (spec 6b/6d — the required
 * feedback loop for MANUAL Amazon Retail orders placed via the Buy Queue):
 *   Your package has shipped!
 *   Order #: 111-2223334-5556667
 *   Tracking ID: TBA123456789012
 *   Carrier: Amazon Logistics
 */
export function parseAmazonRetail(input: EmailParseInput): EmailParseResult {
  const trackingMatch = input.text.match(/Tracking (?:ID|Number|#):\s*([A-Z0-9]{8,30})/i);
  if (!trackingMatch) {
    return { candidate: null, confidence: 0 };
  }

  const orderMatch = input.text.match(/Order #:?\s*(\d{3}-\d{7}-\d{7})/i);
  const carrierMatch = input.text.match(/Carrier:\s*([A-Za-z ]+)/i);
  const carrierRaw = carrierMatch?.[1]?.trim().toLowerCase();

  return {
    candidate: {
      trackingNumber: (trackingMatch[1] ?? '').toUpperCase().trim(),
      externalOrderRef: orderMatch?.[1],
      carrierDeclared: carrierRaw?.includes('amazon') ? 'AMZL' : undefined,
    },
    confidence: 1,
  };
}
