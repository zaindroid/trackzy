import { describe, expect, it } from 'vitest';
import { MockAliExpressClient } from './mock.js';

describe('MockAliExpressClient', () => {
  const client = new MockAliExpressClient();

  it('returns a deterministic search result', async () => {
    const a = await client.searchProduct('blue gadget');
    const b = await client.searchProduct('blue gadget');
    expect(a).toEqual(b);
  });

  it('reflects longer, less certain shipping than domestic suppliers', async () => {
    const offer = await client.getOffer('AE10000123');
    expect(offer.shipDays).toBeGreaterThan(7);
  });

  it('creates an order and returns a supplierOrderRef', async () => {
    const result = await client.createOrder({
      supplierProductId: 'AE10000123',
      quantity: 2,
      shipTo: { name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US' },
    });
    expect(result.supplierOrderRef).toContain('AE10000123');
  });

  it('returns a Cainiao-style international tracking number', async () => {
    const tracking = await client.getTracking('mock-ae-order-1-AE10000123');
    expect(tracking.trackingNumber).toMatch(/^LP\d{13}CN$/);
    expect(tracking.carrier).toBe('CAINIAO');
  });
});
