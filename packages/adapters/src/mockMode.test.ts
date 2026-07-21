import { describe, expect, it } from 'vitest';
import { isMockMode } from './mockMode.js';

describe('isMockMode', () => {
  it('is true when MOCK_MODE=true regardless of keys', () => {
    expect(isMockMode('true', 'a-real-looking-key')).toBe(true);
  });

  it('is true when any key is a PLACEHOLDER__ value', () => {
    expect(isMockMode(undefined, 'real-key', 'PLACEHOLDER__SOMETHING')).toBe(true);
  });

  it('is true when a key is missing entirely', () => {
    expect(isMockMode(undefined, undefined)).toBe(true);
  });

  it('is false when MOCK_MODE is unset and all keys look real', () => {
    expect(isMockMode(undefined, 'sk_live_abc123')).toBe(false);
  });
});
