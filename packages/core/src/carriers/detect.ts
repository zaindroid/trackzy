import type { Carrier, CarrierDetectionResult, CarrierValidationResult } from '../types.js';
import { isValidUPS } from './ups.js';
import { isValidUSPS, hasAmbiguousUspsPrefix } from './usps.js';
import { isValidFedEx } from './fedex.js';
import { isValidDHL } from './dhl.js';
import { isValidAMZL } from './amzl.js';

export { isValidUPS, isValidUSPS, isValidFedEx, isValidDHL, isValidAMZL, hasAmbiguousUspsPrefix };

export function validateCarrier(carrier: Carrier, trackingNumber: string): CarrierValidationResult {
  switch (carrier) {
    case 'UPS':
      return isValidUPS(trackingNumber);
    case 'USPS':
      return isValidUSPS(trackingNumber);
    case 'FEDEX':
      return isValidFedEx(trackingNumber);
    case 'DHL':
      return isValidDHL(trackingNumber);
    case 'AMZL':
      return isValidAMZL(trackingNumber);
  }
}

/**
 * Carrier detection chain (spec section 6c). Priority:
 *  1. carrierDeclared, if its own checksum/format passes.
 *  2. AMZL ("TBA" + 12 digits, format-only — weak, but an unambiguous prefix).
 *  3. UPS (1Z + mod-10 checksum).
 *  4. USPS (20/22 digit + mod-10 checksum) — 92-95 prefixed numbers are
 *     ambiguous with FedEx SmartPost / UPS SurePost when nothing was declared.
 *  5. DHL AWB (10 digit + mod-7 checksum).
 *  6. FedEx (12/15 digit, format-only — weak) / DHL eCommerce (JD-prefixed, format-only — weak).
 *  7. Nothing matched -> needs_review, carrier_final stays null.
 */
export function detectCarrier(
  trackingNumber: string,
  carrierDeclared?: Carrier | null,
): CarrierDetectionResult {
  const declared = carrierDeclared ?? null;

  if (declared) {
    const declaredResult = validateCarrier(declared, trackingNumber);
    if (declaredResult.valid) {
      return {
        carrierDeclared: declared,
        carrierDetected: declared,
        carrierFinal: declared,
        ambiguous: false,
        weak: declaredResult.weak,
        needsReview: false,
      };
    }
    // Declared carrier failed its own validation: fall through to auto-detection.
  }

  const amzl = isValidAMZL(trackingNumber);
  if (amzl.valid) {
    return {
      carrierDeclared: declared,
      carrierDetected: 'AMZL',
      carrierFinal: 'AMZL',
      ambiguous: false,
      weak: true,
      needsReview: false,
    };
  }

  const ups = isValidUPS(trackingNumber);
  if (ups.valid) {
    return {
      carrierDeclared: declared,
      carrierDetected: 'UPS',
      carrierFinal: 'UPS',
      ambiguous: false,
      weak: false,
      needsReview: false,
    };
  }

  const usps = isValidUSPS(trackingNumber);
  if (usps.valid) {
    const ambiguous = hasAmbiguousUspsPrefix(trackingNumber) && !declared;
    return {
      carrierDeclared: declared,
      carrierDetected: 'USPS',
      carrierFinal: ambiguous ? null : 'USPS',
      ambiguous,
      weak: false,
      needsReview: ambiguous,
    };
  }

  const dhl = isValidDHL(trackingNumber);
  if (dhl.valid && !dhl.weak) {
    return {
      carrierDeclared: declared,
      carrierDetected: 'DHL',
      carrierFinal: 'DHL',
      ambiguous: false,
      weak: false,
      needsReview: false,
    };
  }

  const fedex = isValidFedEx(trackingNumber);
  if (fedex.valid) {
    return {
      carrierDeclared: declared,
      carrierDetected: 'FEDEX',
      carrierFinal: 'FEDEX',
      ambiguous: false,
      weak: true,
      needsReview: false,
    };
  }

  if (dhl.valid && dhl.weak) {
    return {
      carrierDeclared: declared,
      carrierDetected: 'DHL',
      carrierFinal: 'DHL',
      ambiguous: false,
      weak: true,
      needsReview: false,
    };
  }

  return {
    carrierDeclared: declared,
    carrierDetected: null,
    carrierFinal: null,
    ambiguous: false,
    weak: false,
    needsReview: true,
  };
}
