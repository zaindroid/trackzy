import type { EmailParseInput, EmailParseResult } from './types.js';
import { normalizeCarrierName } from './carrierName.js';

/**
 * Globex Goods shipment-notification format:
 *   Shipment Notification
 *   Order Ref: GX-88213
 *   Track your package: 9400111899223197428490
 *   Shipped via USPS
 */
export function parseGlobexGoods(input: EmailParseInput): EmailParseResult {
  const trackingMatch = input.text.match(/Track your package:\s*([A-Z0-9]{8,30})/i);
  if (!trackingMatch) {
    return { candidate: null, confidence: 0 };
  }

  const orderMatch = input.text.match(/Order Ref:\s*([A-Z]{2,4}-\d{3,10})/i);
  const carrierMatch = input.text.match(/Shipped via\s*([A-Za-z ]+)/i);

  return {
    candidate: {
      trackingNumber: (trackingMatch[1] ?? '').toUpperCase().trim(),
      externalOrderRef: orderMatch?.[1]?.toUpperCase(),
      carrierDeclared: normalizeCarrierName(carrierMatch?.[1]),
    },
    confidence: 1,
  };
}
