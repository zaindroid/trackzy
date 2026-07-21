import type { Carrier, TrackingStatus } from '@fulfillment-tracker/core';

export interface SeventeenTrackEnv {
  MOCK_MODE?: string;
  SEVENTEENTRACK_API_KEY?: string;
}

export interface RegisterResult {
  registered: boolean;
  carrierResolved?: Carrier;
}

export interface TrackingStatusResult {
  status: TrackingStatus;
  carrierResolved?: Carrier;
  lastEventAt?: number;
}

export interface TrackingEvents {
  /** Registers a tracking number for carrier auto-detect + status push updates. */
  register(trackingNumber: string, carrierHint?: Carrier | null): Promise<RegisterResult>;
  getStatus(trackingNumber: string): Promise<TrackingStatusResult>;
}
