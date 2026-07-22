import type { Carrier } from '@fulfillment-tracker/core';
import type { RegisterResult, SeventeenTrackEnv, TrackingEvents, TrackingStatusResult } from './iface.js';

// 17TRACK carrier codes (https://res.17track.net/asset/carrier/info/carrier.all.json)
const CARRIER_CODE: Record<Carrier, number> = {
  UPS: 100002,
  USPS: 21051,
  FEDEX: 100003,
  DHL: 100001,
  // TODO(HUMAN): verify against 17TRACK's live carrier list once registered — see DEPLOY.md.
  AMZL: 100026,
};

const CARRIER_BY_CODE: Record<number, Carrier> = Object.fromEntries(
  Object.entries(CARRIER_CODE).map(([carrier, code]) => [code, carrier as Carrier]),
) as Record<number, Carrier>;

// 17TRACK package status codes -> our internal TrackingStatus.
const STATUS_MAP: Record<string, TrackingStatusResult['status']> = {
  NotFound: 'pending',
  InfoReceived: 'pending',
  InTransit: 'in_transit',
  Expired: 'exception',
  AvailableForPickup: 'in_transit',
  OutForDelivery: 'in_transit',
  DeliveryFailure: 'exception',
  Delivered: 'delivered',
  Exception: 'exception',
};

export class RealTrackingEvents implements TrackingEvents {
  constructor(private readonly env: SeventeenTrackEnv) {}

  private headers(): HeadersInit {
    return {
      '17token': this.env.SEVENTEENTRACK_API_KEY ?? '',
      'Content-Type': 'application/json',
    };
  }

  async register(trackingNumber: string, carrierHint?: Carrier | null): Promise<RegisterResult> {
    const body = [
      {
        number: trackingNumber,
        carrier: carrierHint ? CARRIER_CODE[carrierHint] : undefined,
        auto_detection: !carrierHint,
      },
    ];
    const res = await fetch('https://api.17track.net/track/v2.2/register', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`17TRACK register failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: { accepted: { number: string; carrier: number }[] };
    };
    const accepted = json.data.accepted[0];
    return {
      registered: !!accepted,
      carrierResolved: accepted ? CARRIER_BY_CODE[accepted.carrier] : undefined,
    };
  }

  async getStatus(trackingNumber: string): Promise<TrackingStatusResult> {
    const res = await fetch('https://api.17track.net/track/v2.2/gettrackinfo', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify([{ number: trackingNumber }]),
    });
    if (!res.ok) {
      throw new Error(`17TRACK gettrackinfo failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: {
        accepted: {
          number: string;
          carrier: number;
          track_info: { latest_status: { status: string }; latest_event?: { time_utc: string } };
        }[];
      };
    };
    const info = json.data.accepted[0];
    if (!info) {
      return { status: 'pending' };
    }
    return {
      status: STATUS_MAP[info.track_info.latest_status.status] ?? 'pending',
      carrierResolved: CARRIER_BY_CODE[info.carrier],
      lastEventAt: info.track_info.latest_event
        ? Date.parse(info.track_info.latest_event.time_utc)
        : undefined,
    };
  }
}
