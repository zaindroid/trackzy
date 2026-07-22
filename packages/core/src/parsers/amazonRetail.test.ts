import { describe, expect, it } from 'vitest';
import { parseAmazonRetail } from './amazonRetail.js';

describe('parseAmazonRetail', () => {
  it('extracts tracking number, order ref, and AMZL carrier', () => {
    const result = parseAmazonRetail({
      subject: 'Your package has shipped!',
      text: ['Your package has shipped!', 'Order #: 111-2223334-5556667', 'Tracking ID: TBA123456789012', 'Carrier: Amazon Logistics'].join(
        '\n',
      ),
    });
    expect(result.confidence).toBe(1);
    expect(result.candidate).toEqual({
      trackingNumber: 'TBA123456789012',
      externalOrderRef: '111-2223334-5556667',
      carrierDeclared: 'AMZL',
    });
  });

  it('returns null candidate with zero confidence when no tracking id is present', () => {
    const result = parseAmazonRetail({ subject: 'Your order confirmation', text: 'Thanks for your order, it is being prepared.' });
    expect(result.candidate).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
