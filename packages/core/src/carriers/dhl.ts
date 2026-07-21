import type { CarrierValidationResult } from '../types.js';

const DHL_AWB_FORMAT = /^\d{10}$/;
const DHL_ECOMMERCE_FORMAT = /^JD\d{16,18}$/;

/**
 * Two DHL formats:
 *  - 10-digit AWB (DHL Express / IATA-style air waybill): check digit is the
 *    9-digit body mod 7 (the standard IATA AWB check-digit rule).
 *  - "JD"-prefixed DHL eCommerce/Parcel numbers: DHL does not publish a
 *    checksum for these, so it's a format-only (weak) match.
 */
export function isValidDHL(trackingNumber: string): CarrierValidationResult {
  const tn = trackingNumber.trim().toUpperCase();

  if (DHL_AWB_FORMAT.test(tn)) {
    const body = Number(tn.slice(0, 9));
    const checkDigit = Number(tn.slice(9, 10));
    return { valid: body % 7 === checkDigit, weak: false };
  }

  if (DHL_ECOMMERCE_FORMAT.test(tn)) {
    return { valid: true, weak: true };
  }

  return { valid: false, weak: false };
}
