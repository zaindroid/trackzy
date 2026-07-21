import type { CarrierValidationResult } from '../types.js';

const USPS_FORMAT = /^\d{20}$|^\d{22}$/;
export const USPS_AMBIGUOUS_PREFIXES = ['92', '93', '94', '95'];

/**
 * USPS 20/22-digit IMpb-style tracking numbers. Check digit (last digit) is a
 * mod-10 checksum over the preceding digits using alternating weights 3/1
 * starting from the digit immediately left of the check digit (standard
 * USPS/S10 weighting).
 */
export function isValidUSPS(trackingNumber: string): CarrierValidationResult {
  const tn = trackingNumber.trim();
  if (!USPS_FORMAT.test(tn)) {
    return { valid: false, weak: false };
  }

  const body = tn.slice(0, -1);
  const checkDigit = Number(tn.slice(-1));

  let sum = 0;
  let weight: 3 | 1 = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const mod = sum % 10;
  const computed = mod === 0 ? 0 : 10 - mod;

  return { valid: computed === checkDigit, weak: false };
}

export function hasAmbiguousUspsPrefix(trackingNumber: string): boolean {
  const tn = trackingNumber.trim();
  return USPS_AMBIGUOUS_PREFIXES.some((p) => tn.startsWith(p));
}
