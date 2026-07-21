import { describe, expect, it } from 'vitest';
import { isValidFedEx } from './fedex.js';

describe('isValidFedEx', () => {
  it('accepts a 12-digit number as a weak (format-only) match', () => {
    expect(isValidFedEx('123456789012')).toEqual({ valid: true, weak: true });
  });

  it('accepts a 15-digit number as a weak (format-only) match', () => {
    expect(isValidFedEx('123456789012345')).toEqual({ valid: true, weak: true });
  });

  // FedEx publishes no checksum, so a digit flip within a valid length
  // cannot be caught here — negative cases must instead be format violations.
  it('rejects wrong length (13 digits)', () => {
    expect(isValidFedEx('1234567890123').valid).toBe(false);
  });

  it('rejects non-numeric characters', () => {
    expect(isValidFedEx('12345678901A').valid).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidFedEx('').valid).toBe(false);
  });
});
