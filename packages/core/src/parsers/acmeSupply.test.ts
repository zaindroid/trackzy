import { describe, expect, it } from 'vitest';
import { parseAcmeSupply } from './acmeSupply.js';

describe('parseAcmeSupply', () => {
  it('extracts tracking number, order ref, carrier, and sku', () => {
    const result = parseAcmeSupply({
      subject: 'Your order has shipped',
      text: [
        'Order #AC-10293 has shipped!',
        'Tracking Number: 1Z999AA10123456780',
        'Carrier: UPS',
        'SKU: WIDGET-RED-L',
      ].join('\n'),
    });
    expect(result.confidence).toBe(1);
    expect(result.candidate).toEqual({
      trackingNumber: '1Z999AA10123456780',
      externalOrderRef: 'AC-10293',
      carrierDeclared: 'UPS',
      sku: 'WIDGET-RED-L',
    });
  });

  it('returns null candidate with zero confidence when tracking number is absent', () => {
    const result = parseAcmeSupply({ subject: 'Hi', text: 'Your order is processing.' });
    expect(result.candidate).toBeNull();
    expect(result.confidence).toBe(0);
  });
});
