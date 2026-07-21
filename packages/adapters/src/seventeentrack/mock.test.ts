import { describe, expect, it } from 'vitest';
import { MockTrackingEvents } from './mock.js';

describe('MockTrackingEvents', () => {
  const events = new MockTrackingEvents();

  it('always accepts registration', async () => {
    const result = await events.register('1Z999AA10123456780', 'UPS');
    expect(result.registered).toBe(true);
    expect(result.carrierResolved).toBe('UPS');
  });

  it('reports delivered for numbers ending in 0', async () => {
    expect((await events.getStatus('1Z999AA10123456780')).status).toBe('delivered');
  });

  it('reports exception for numbers ending in 9', async () => {
    expect((await events.getStatus('9200111899223197428499')).status).toBe('exception');
  });

  it('reports in_transit otherwise', async () => {
    expect((await events.getStatus('1234567891')).status).toBe('in_transit');
  });
});
