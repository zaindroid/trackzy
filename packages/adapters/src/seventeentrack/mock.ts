import type { Carrier } from '@fulfillment-tracker/core';
import type { RegisterResult, TrackingEvents, TrackingStatusResult } from './iface.js';

/**
 * Deterministic mock: registration always succeeds; status is derived from
 * the tracking number itself so repeated calls/tests are stable without
 * needing external state. Numbers ending in '0' simulate "delivered",
 * ending in '9' simulate "exception", everything else "in_transit".
 */
export class MockTrackingEvents implements TrackingEvents {
  async register(trackingNumber: string, carrierHint?: Carrier | null): Promise<RegisterResult> {
    return { registered: true, carrierResolved: carrierHint ?? undefined };
  }

  async getStatus(trackingNumber: string): Promise<TrackingStatusResult> {
    const lastChar = trackingNumber.trim().slice(-1);
    const status: TrackingStatusResult['status'] =
      lastChar === '0' ? 'delivered' : lastChar === '9' ? 'exception' : 'in_transit';
    return { status, lastEventAt: Date.now() };
  }
}
