import { describe, expect, it } from 'vitest';
import { MockShopifyClient } from './mock.js';

describe('MockShopifyClient', () => {
  it('derives a stable fulfillment-order-line-item id per external line item', async () => {
    const client = new MockShopifyClient();
    const result = await client.getFulfillmentOrder('demo-store.myshopify.com', 'gid://shopify/Order/1', [
      'gid://shopify/LineItem/1',
      'gid://shopify/LineItem/2',
    ]);
    expect(result.fulfillmentOrderId).toBe('gid://shopify/FulfillmentOrder/1');
    expect(result.lineItemMap['gid://shopify/LineItem/1']).toBe('gid://shopify/FulfillmentOrderLineItem/1');
    expect(result.lineItemMap['gid://shopify/LineItem/2']).toBe('gid://shopify/FulfillmentOrderLineItem/2');
  });

  it('records created fulfillments and returns an incrementing id', async () => {
    const client = new MockShopifyClient();
    const first = await client.createFulfillment('demo-store.myshopify.com', {
      fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/1',
      trackingNumber: '1Z999AA10123456780',
      trackingCompany: 'UPS',
      lineItems: [{ fulfillmentOrderLineItemId: 'gid://shopify/FulfillmentOrderLineItem/1', quantity: 1 }],
    });
    expect(first.fulfillmentId).toBe('gid://shopify/Fulfillment/mock-1');
    expect(client.createdFulfillments).toHaveLength(1);
  });
});
