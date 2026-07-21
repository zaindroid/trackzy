import { describe, expect, it } from 'vitest';
import { isValidDHL } from './dhl.js';

// AWB body 123456789 % 7 === 1
const VALID_AWB = '1234567891';

describe('isValidDHL', () => {
  it('accepts a valid 10-digit AWB number', () => {
    expect(isValidDHL(VALID_AWB)).toEqual({ valid: true, weak: false });
  });

  it('rejects when the AWB check digit is flipped', () => {
    const flipped = VALID_AWB.slice(0, -1) + (VALID_AWB.slice(-1) === '1' ? '2' : '1');
    expect(isValidDHL(flipped).valid).toBe(false);
  });

  it('rejects when an interior AWB digit is flipped', () => {
    const flipped = '2' + VALID_AWB.slice(1);
    expect(isValidDHL(flipped).valid).toBe(false);
  });

  it('accepts a JD-prefixed eCommerce number as a weak (format-only) match', () => {
    expect(isValidDHL('JD12345678901234567')).toEqual({ valid: true, weak: true });
  });

  it('rejects a malformed JD number (too short)', () => {
    expect(isValidDHL('JD123').valid).toBe(false);
  });

  it('rejects garbage input', () => {
    expect(isValidDHL('not-a-tracking-number').valid).toBe(false);
  });
});
