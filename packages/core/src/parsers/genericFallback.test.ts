import { describe, expect, it } from 'vitest';
import { parseGenericFallback } from './genericFallback.js';

describe('parseGenericFallback', () => {
  it('always returns zero confidence and no candidate, forcing the Gemini fallback', () => {
    const result = parseGenericFallback({ subject: 'Your order has shipped', text: 'Tracking: ABC123456789' });
    expect(result).toEqual({ candidate: null, confidence: 0 });
  });
});
