import { describe, expect, it } from 'vitest';
import { MockBluecareExpressClient } from './mock.js';

describe('MockBluecareExpressClient', () => {
  it('produces a deterministic BCE<random> proxy tracking number', async () => {
    const client = new MockBluecareExpressClient();
    const a = await client.convertTracking('TBA123456789012', 'AMZL');
    const b = await client.convertTracking('TBA123456789012', 'AMZL');
    expect(a).toEqual(b);
    expect(a.proxyTracking).toMatch(/^BCE[0-9A-F]{10}$/);
    expect(a.proxyCarrier).toBe('bluecare_express');
  });

  it('produces different proxy numbers for different original tracking numbers', async () => {
    const client = new MockBluecareExpressClient();
    const a = await client.convertTracking('TBA123456789012', 'AMZL');
    const b = await client.convertTracking('TBA987654321098', 'AMZL');
    expect(a.proxyTracking).not.toBe(b.proxyTracking);
  });
});
