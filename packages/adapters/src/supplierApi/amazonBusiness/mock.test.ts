import { describe, expect, it } from 'vitest';
import { MockAmazonBusinessClient } from './mock.js';

describe('MockAmazonBusinessClient', () => {
  const client = new MockAmazonBusinessClient();

  it('returns a deterministic search result for the same query', async () => {
    const a = await client.searchProduct('red widget');
    const b = await client.searchProduct('red widget');
    expect(a).toEqual(b);
  });

  it('returns a deterministic, positive-cost offer', async () => {
    const offer = await client.getOffer('B0EXAMPLE001');
    expect(offer.costCents).toBeGreaterThan(0);
    expect(offer.inStock).toBe(true);
  });

  it('creates an order and returns a supplierOrderRef containing the product id', async () => {
    const result = await client.createOrder({
      supplierProductId: 'B0EXAMPLE001',
      quantity: 1,
      shipTo: { name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US' },
    });
    expect(result.supplierOrderRef).toContain('B0EXAMPLE001');
  });

  it('returns a well-formed TBA (Amazon Logistics) tracking number', async () => {
    const tracking = await client.getTracking('mock-ab-order-1-B0EXAMPLE001');
    expect(tracking.trackingNumber).toMatch(/^TBA\d{12}$/);
    expect(tracking.carrier).toBe('AMZL');
  });
});
