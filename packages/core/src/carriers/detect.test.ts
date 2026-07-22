import { describe, expect, it } from 'vitest';
import { detectCarrier } from './detect.js';

const VALID_UPS = '1Z999AA10123456780';
const VALID_USPS_AMBIGUOUS = '9200111899223197428499'; // starts with 92
const VALID_USPS_PLAIN = '70123456789012345674';
const VALID_FEDEX = '123456789012345';
const VALID_DHL_AWB = '1234567891';
const VALID_DHL_JD = 'JD12345678901234567';
const VALID_AMZL = 'TBA123456789012';

describe('detectCarrier', () => {
  it('detects UPS from format + checksum, unambiguous', () => {
    const result = detectCarrier(VALID_UPS);
    expect(result).toEqual({
      carrierDeclared: null,
      carrierDetected: 'UPS',
      carrierFinal: 'UPS',
      ambiguous: false,
      weak: false,
      needsReview: false,
    });
  });

  it('flags a bare 92-prefixed USPS-format number as ambiguous when nothing declared', () => {
    const result = detectCarrier(VALID_USPS_AMBIGUOUS);
    expect(result.carrierDetected).toBe('USPS');
    expect(result.carrierFinal).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.needsReview).toBe(true);
  });

  it('resolves the ambiguity when a carrier is declared and validates', () => {
    const result = detectCarrier(VALID_USPS_AMBIGUOUS, 'USPS');
    expect(result.carrierFinal).toBe('USPS');
    expect(result.ambiguous).toBe(false);
    expect(result.needsReview).toBe(false);
  });

  it('does not flag a non-92-95-prefixed USPS number as ambiguous', () => {
    const result = detectCarrier(VALID_USPS_PLAIN);
    expect(result.carrierFinal).toBe('USPS');
    expect(result.ambiguous).toBe(false);
  });

  it('detects DHL AWB with a strong checksum', () => {
    const result = detectCarrier(VALID_DHL_AWB);
    expect(result.carrierFinal).toBe('DHL');
    expect(result.weak).toBe(false);
  });

  it('detects FedEx as a weak, format-only match', () => {
    const result = detectCarrier(VALID_FEDEX);
    expect(result.carrierFinal).toBe('FEDEX');
    expect(result.weak).toBe(true);
    expect(result.needsReview).toBe(false);
  });

  it('detects DHL eCommerce (JD-prefixed) as a weak, format-only match', () => {
    const result = detectCarrier(VALID_DHL_JD);
    expect(result.carrierFinal).toBe('DHL');
    expect(result.weak).toBe(true);
  });

  it('falls back to auto-detection when the declared carrier fails its own checksum', () => {
    // Declared UPS but the number is actually a valid DHL AWB.
    const result = detectCarrier(VALID_DHL_AWB, 'UPS');
    expect(result.carrierDeclared).toBe('UPS');
    expect(result.carrierFinal).toBe('DHL');
  });

  it('detects AMZL (Amazon Logistics) as a weak, format-only match', () => {
    const result = detectCarrier(VALID_AMZL);
    expect(result.carrierFinal).toBe('AMZL');
    expect(result.weak).toBe(true);
    expect(result.needsReview).toBe(false);
  });

  it('needs review when nothing matches any known format', () => {
    const result = detectCarrier('not-a-real-tracking-number');
    expect(result.carrierDetected).toBeNull();
    expect(result.carrierFinal).toBeNull();
    expect(result.needsReview).toBe(true);
  });
});
