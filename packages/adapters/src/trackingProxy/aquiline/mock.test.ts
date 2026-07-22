import { describe, expect, it } from 'vitest';
import { MockAquilineClient } from './mock.js';

describe('MockAquilineClient', () => {
  it('produces a deterministic AQL<random> proxy tracking number', async () => {
    const client = new MockAquilineClient();
    const a = await client.convertTracking('TBA123456789012', 'AMZL');
    const b = await client.convertTracking('TBA123456789012', 'AMZL');
    expect(a).toEqual(b);
    expect(a.proxyTracking).toMatch(/^AQL[0-9A-F]{10}$/);
    expect(a.proxyCarrier).toBe('aquiline');
  });
});
