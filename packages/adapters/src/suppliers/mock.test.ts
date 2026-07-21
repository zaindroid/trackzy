import { describe, expect, it } from 'vitest';
import { MockSupplierClient } from './mock.js';

describe('MockSupplierClient', () => {
  it('quotes a deterministic price for the same sku and quantity', async () => {
    const client = new MockSupplierClient();
    const a = await client.getPrice('https://api.example.com', 'WIDGET-RED-L', 2);
    const b = await client.getPrice('https://api.example.com', 'WIDGET-RED-L', 2);
    expect(a).toEqual(b);
    expect(a.costCents).toBeGreaterThan(0);
  });

  it('creates an order with an estimated ship time ~60s out', async () => {
    const client = new MockSupplierClient();
    const before = Date.now();
    const result = await client.createOrder('https://api.example.com', {
      externalOrderRef: 'AC-10293',
      lineItems: [{ sku: 'WIDGET-RED-L', quantity: 2 }],
    });
    expect(result.supplierOrderId).toContain('AC-10293');
    expect(result.estimatedShipAt).toBeGreaterThanOrEqual(before + 59_000);
  });
});
