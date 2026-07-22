import type { EmailParseInput, EmailParseResult } from './types.js';

/**
 * AliExpress shipping-notification format (spec 6b — the required feedback
 * loop for AliExpress orders, alongside Amazon Retail):
 *   Your order has been shipped!
 *   Order ID: 8012345678901234
 *   Tracking Number: LP00123456789CN
 *   Shipping Company: CAINIAO
 */
export function parseAliExpressShipping(input: EmailParseInput): EmailParseResult {
  const trackingMatch = input.text.match(/Tracking Number:\s*([A-Z0-9]{8,30})/i);
  if (!trackingMatch) {
    return { candidate: null, confidence: 0 };
  }

  const orderMatch = input.text.match(/Order ID:\s*(\d{10,20})/i);

  return {
    candidate: {
      trackingNumber: (trackingMatch[1] ?? '').toUpperCase().trim(),
      externalOrderRef: orderMatch?.[1],
      // AliExpress ships via Cainiao's own network, not a recognized major
      // carrier — leave carrierDeclared unset and let detectCarrier's
      // needs_review fallback handle it (no format we can validate for it).
    },
    confidence: 1,
  };
}
