import type { CarrierValidationResult } from '../types.js';

const UPS_FORMAT = /^1Z[0-9A-Z]{16}$/;

/**
 * UPS "1Z" tracking numbers: 1Z + 6-char shipper id + 2-digit service + 7-digit
 * serial + 1 check digit (18 chars total). Check digit is a mod-10 checksum
 * over the 15 characters between the prefix and the check digit: letters map
 * to (charCode - 'A'.charCode + 1) mod 10 (A=1..I=9, J=0..Z=6... i.e. A=65
 * -> 65-55=10 -> mod10=0 is the classic off-by-one some sources use; we use
 * the widely-implemented `(charCode - 55) % 10` mapping), digits alternate
 * weights 1/2 starting at the leftmost of the 15 characters.
 */
export function isValidUPS(trackingNumber: string): CarrierValidationResult {
  const tn = trackingNumber.trim().toUpperCase();
  if (!UPS_FORMAT.test(tn)) {
    return { valid: false, weak: false };
  }

  const body = tn.slice(2, 17); // 15 chars
  const checkDigit = Number(tn.slice(17, 18));

  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    const val = /[0-9]/.test(ch) ? Number(ch) : (ch.charCodeAt(0) - 55) % 10;
    const weight = i % 2 === 0 ? 1 : 2;
    sum += val * weight;
  }
  const mod = sum % 10;
  const computed = mod === 0 ? 0 : 10 - mod;

  return { valid: computed === checkDigit, weak: false };
}
