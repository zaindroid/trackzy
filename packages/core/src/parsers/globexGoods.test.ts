import { describe, expect, it } from 'vitest';
import { parseGlobexGoods } from './globexGoods.js';

describe('parseGlobexGoods', () => {
  it('extracts tracking number, order ref, and carrier', () => {
    const result = parseGlobexGoods({
      subject: 'Shipment Notification',
      text: [
        'Shipment Notification',
        'Order Ref: GX-88213',
        'Track your package: 9200111899223197428499',
        'Shipped via USPS',
      ].join('\n'),
    });
    expect(result.confidence).toBe(1);
    expect(result.candidate).toEqual({
      trackingNumber: '9200111899223197428499',
      externalOrderRef: 'GX-88213',
      carrierDeclared: 'USPS',
    });
  });

  it('returns null candidate with zero confidence when nothing matches', () => {
    const result = parseGlobexGoods({ subject: 'Newsletter', text: 'Nothing to see here.' });
    expect(result.candidate).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
