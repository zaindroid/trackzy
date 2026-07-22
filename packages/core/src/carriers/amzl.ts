import type { CarrierValidationResult } from '../types.js';

const AMZL_FORMAT = /^TBA\d{12}$/;

/**
 * Amazon Logistics ("TBA" + 12 digits) tracking numbers. Amazon publishes no
 * checksum, so — same as FedEx — this is format-only and always `weak: true`
 * on a match. Detecting AMZL correctly matters beyond ordinary carrier
 * display: it's the trigger condition for the tracking-proxy middleware
 * (spec section 7) that rewrites AMZL numbers before they reach eBay.
 */
export function isValidAMZL(trackingNumber: string): CarrierValidationResult {
  const tn = trackingNumber.trim().toUpperCase();
  if (!AMZL_FORMAT.test(tn)) {
    return { valid: false, weak: false };
  }
  return { valid: true, weak: true };
}
