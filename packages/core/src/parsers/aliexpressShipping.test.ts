import { describe, expect, it } from 'vitest';
import { parseAliExpressShipping } from './aliexpressShipping.js';

describe('parseAliExpressShipping', () => {
  it('extracts tracking number and order ref, without a declared carrier', () => {
    const result = parseAliExpressShipping({
      subject: 'Your order has been shipped!',
      text: ['Your order has been shipped!', 'Order ID: 8012345678901234', 'Tracking Number: LP00123456789CN', 'Shipping Company: CAINIAO'].join(
        '\n',
      ),
    });
    expect(result.confidence).toBe(1);
    expect(result.candidate).toEqual({
      trackingNumber: 'LP00123456789CN',
      externalOrderRef: '8012345678901234',
      carrierDeclared: undefined,
    });
  });

  it('returns null candidate with zero confidence when no tracking number is present', () => {
    const result = parseAliExpressShipping({ subject: 'Order confirmed', text: 'Your order has been confirmed and is being processed.' });
    expect(result.candidate).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
