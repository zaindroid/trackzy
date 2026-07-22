import { describe, expect, it } from 'vitest';
import { MockEbayOrderSource } from './mock.js';
import { NonApiModeError } from './real.js';

describe('MockEbayOrderSource', () => {
  it('lists fixture orders for a past `since`', async () => {
    const source = new MockEbayOrderSource();
    const orders = await source.listNewOrders(0);
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0]?.externalOrderId).toBe('ebay-mock-16-11635-28233');
  });

  it('returns an empty list for a future `since`', async () => {
    const source = new MockEbayOrderSource();
    const orders = await source.listNewOrders(Date.now() + 1_000_000);
    expect(orders).toEqual([]);
  });

  it('getOrder finds a fixture order by id and returns null otherwise', async () => {
    const source = new MockEbayOrderSource();
    expect((await source.getOrder('ebay-mock-16-11635-28233'))?.externalOrderNumber).toBe('16-11635-28233');
    expect(await source.getOrder('does-not-exist')).toBeNull();
  });

  it('records pushTracking calls in normal (API) mode', async () => {
    const source = new MockEbayOrderSource(false);
    await source.pushTracking('order-1', { trackingNumber: '1Z999AA10123456780', carrier: 'UPS' });
    expect(source.calls).toEqual([
      { method: 'pushTracking', args: ['order-1', { trackingNumber: '1Z999AA10123456780', carrier: 'UPS' }] },
    ]);
  });

  it('throws NonApiModeError instead of pushing when non_api_mode is set', async () => {
    const source = new MockEbayOrderSource(true);
    await expect(
      source.pushTracking('order-1', { trackingNumber: 'BCE7F3A9D2E1', carrier: 'bluecare_express' }),
    ).rejects.toBeInstanceOf(NonApiModeError);
    expect(source.calls).toEqual([]); // never recorded as a normal API call
  });

  it('records sendBuyerMessage, updateListing, and pauseListing calls', async () => {
    const source = new MockEbayOrderSource();
    await source.sendBuyerMessage('order-1', 'Your item has shipped!');
    await source.updateListing('listing-1', { priceCents: 4999 });
    await source.pauseListing('listing-1');
    expect(source.calls.map((c) => c.method)).toEqual(['sendBuyerMessage', 'updateListing', 'pauseListing']);
  });

  it('lists fixture listings', async () => {
    const source = new MockEbayOrderSource();
    const listings = await source.listListings();
    expect(listings.length).toBeGreaterThan(0);
    expect(listings.every((l) => l.sku && l.priceCents > 0)).toBe(true);
  });
});
