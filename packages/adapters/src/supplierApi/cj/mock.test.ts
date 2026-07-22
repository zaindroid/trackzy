import { describe, expect, it } from 'vitest';
import { MockCjClient } from './mock.js';

describe('MockCjClient', () => {
  const client = new MockCjClient();

  it('returns a deterministic search result', async () => {
    const a = await client.searchProduct('green gizmo');
    const b = await client.searchProduct('green gizmo');
    expect(a).toEqual(b);
  });

  it('returns a mid-range shipping time between domestic and AliExpress', async () => {
    const offer = await client.getOffer('CJ123456');
    expect(offer.shipDays).toBeGreaterThan(2);
    expect(offer.shipDays).toBeLessThan(12);
  });

  it('creates an order and returns a supplierOrderRef', async () => {
    const result = await client.createOrder({
      supplierProductId: 'CJ123456',
      quantity: 1,
      shipTo: { name: 'A', address1: 'B', city: 'C', state: 'D', zip: 'E', country: 'US' },
    });
    expect(result.supplierOrderRef).toContain('CJ123456');
  });

  it('returns a CJPacket-style tracking number', async () => {
    const tracking = await client.getTracking('mock-cj-order-1-CJ123456');
    expect(tracking.trackingNumber).toMatch(/^CJPKT\d{10}$/);
    expect(tracking.carrier).toBe('CJPacket');
  });
});
