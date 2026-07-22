import { describe, expect, it } from 'vitest';
import { isValidAMZL } from './amzl.js';

describe('isValidAMZL', () => {
  it('accepts a well-formed TBA number as a weak (format-only) match', () => {
    expect(isValidAMZL('TBA123456789012')).toEqual({ valid: true, weak: true });
  });

  it('is case-insensitive on the TBA prefix', () => {
    expect(isValidAMZL('tba123456789012').valid).toBe(true);
  });

  it('rejects wrong digit count', () => {
    expect(isValidAMZL('TBA12345678901').valid).toBe(false); // 11 digits
    expect(isValidAMZL('TBA1234567890123').valid).toBe(false); // 13 digits
  });

  it('rejects a missing or wrong prefix', () => {
    expect(isValidAMZL('123456789012').valid).toBe(false);
    expect(isValidAMZL('TBB123456789012').valid).toBe(false);
  });
});
