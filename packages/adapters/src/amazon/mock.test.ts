import { describe, expect, it } from 'vitest';
import { MockAmazonOrderSource } from './mock.js';

describe('MockAmazonOrderSource', () => {
  it('lists fixture orders for a past `since`, with shipTo already populated', async () => {
    const source = new MockAmazonOrderSource();
    const orders = await source.listNewOrders(0);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0]?.shipTo).toBeDefined();
  });

  it('returns an empty list for a future `since`', async () => {
    const source = new MockAmazonOrderSource();
    expect(await source.listNewOrders(Date.now() + 1_000_000)).toEqual([]);
  });

  it('getOrder finds a fixture order by id and returns null otherwise', async () => {
    const source = new MockAmazonOrderSource();
    expect((await source.getOrder('111-2223334-5556667'))?.externalOrderId).toBe('111-2223334-5556667');
    expect(await source.getOrder('does-not-exist')).toBeNull();
  });

  it('records pushTracking, sendBuyerMessage, updateListing, and pauseListing calls', async () => {
    const source = new MockAmazonOrderSource();
    await source.pushTracking('order-1', { trackingNumber: 'TBA123456789012', carrier: 'AMZL' });
    await source.sendBuyerMessage('order-1', 'Your item has shipped!');
    await source.updateListing('listing-1', { quantityAvailable: 0 });
    await source.pauseListing('listing-1');
    expect(source.calls.map((c) => c.method)).toEqual(['pushTracking', 'sendBuyerMessage', 'updateListing', 'pauseListing']);
  });

  it('lists fixture listings', async () => {
    const source = new MockAmazonOrderSource();
    const listings = await source.listListings();
    expect(listings.length).toBeGreaterThan(0);
  });
});
