import { describe, expect, it } from 'vitest';
import { shouldRouteThroughTrackingProxy } from './trackingProxy.js';

describe('shouldRouteThroughTrackingProxy', () => {
  it('routes an AMZL (TBA) tracking number through the proxy when the destination is eBay', () => {
    expect(shouldRouteThroughTrackingProxy('AMZL', 'ebay')).toBe(true);
  });

  it('does not proxy a non-AMZL carrier (e.g. USPS) even for an eBay destination', () => {
    expect(shouldRouteThroughTrackingProxy('USPS', 'ebay')).toBe(false);
  });

  it('does not proxy AMZL when the destination is not eBay', () => {
    expect(shouldRouteThroughTrackingProxy('AMZL', 'amazon')).toBe(false);
    expect(shouldRouteThroughTrackingProxy('AMZL', 'shopify')).toBe(false);
  });

  it('does not proxy when the carrier is unknown (null)', () => {
    expect(shouldRouteThroughTrackingProxy(null, 'ebay')).toBe(false);
  });

  it.each(['UPS', 'FEDEX', 'DHL'] as const)('does not proxy %s even for an eBay destination', (carrier) => {
    expect(shouldRouteThroughTrackingProxy(carrier, 'ebay')).toBe(false);
  });
});
