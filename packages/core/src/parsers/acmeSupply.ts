import type { EmailParseInput, EmailParseResult } from './types.js';
import { normalizeCarrierName } from './carrierName.js';

/**
 * Acme Supply Co. shipping-confirmation format:
 *   Order #AC-10293 has shipped!
 *   Tracking Number: 1Z999AA10123456784
 *   Carrier: UPS
 *   SKU: WIDGET-RED-L
 */
export function parseAcmeSupply(input: EmailParseInput): EmailParseResult {
  const trackingMatch = input.text.match(/Tracking Number:\s*([A-Z0-9]{8,30})/i);
  if (!trackingMatch) {
    return { candidate: null, confidence: 0 };
  }

  const orderMatch = input.text.match(/Order #\s*([A-Z]{2,4}-\d{3,10})/i);
  const carrierMatch = input.text.match(/Carrier:\s*([A-Za-z ]+)/i);
  const skuMatch = input.text.match(/SKU:\s*([A-Za-z0-9-]+)/i);

  return {
    candidate: {
      trackingNumber: (trackingMatch[1] ?? '').toUpperCase().trim(),
      externalOrderRef: orderMatch?.[1]?.toUpperCase(),
      carrierDeclared: normalizeCarrierName(carrierMatch?.[1]),
      sku: skuMatch?.[1],
    },
    confidence: 1,
  };
}
