import type { CarrierValidationResult } from '../types.js';

const FEDEX_FORMAT = /^\d{12}$|^\d{15}$/;

/**
 * FedEx publishes no public checksum algorithm for its common 12/15-digit
 * ground/express tracking numbers, so this is a format-only check. Always
 * `weak: true` on a format match — callers should treat this as a lower
 * confidence signal than UPS/USPS/DHL.
 */
export function isValidFedEx(trackingNumber: string): CarrierValidationResult {
  const tn = trackingNumber.trim();
  if (!FEDEX_FORMAT.test(tn)) {
    return { valid: false, weak: false };
  }
  return { valid: true, weak: true };
}
