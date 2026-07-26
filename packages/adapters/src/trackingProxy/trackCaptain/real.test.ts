import { describe, expect, it, vi } from 'vitest';
import { RealTrackCaptainClient } from './real.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ENV = { TRACKCAPTAIN_API_KEY: 'tc_live_test-key' };

describe('RealTrackCaptainClient — match-and-claim (real endpoint shape, confirmed against live public API docs)', () => {
  it('POSTs the destination as snake_case fields with a Bearer token, and maps tracking_number/carrier back', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;
    let capturedAuth: string | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(init?.body as string);
        capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? null;
        return jsonResponse({ tracking_number: '9400111899223197428490', carrier: 'FedEx' });
      }),
    );

    const client = new RealTrackCaptainClient(ENV);
    const result = await client.convertTracking('TBA123456789012', 'AMZL', {
      city: 'Houston',
      state: 'TX',
      zip: '77044',
      country: 'US',
      deliveryDate: '2026-04-28',
    });

    expect(capturedUrl).toBe('https://trackcaptain.com/api/v1/tracking/match-and-claim');
    expect(capturedAuth).toBe('Bearer tc_live_test-key');
    expect(capturedBody).toEqual({ city: 'Houston', state: 'TX', zip: '77044', country: 'US', delivery_date: '2026-04-28' });
    expect(result).toEqual({ proxyTracking: '9400111899223197428490', proxyCarrier: 'FedEx' });
    vi.unstubAllGlobals();
  });

  it('surfaces the API error message on a non-2xx response (e.g. insufficient credits)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Insufficient credits.', credit_balance: 0 }, 402)),
    );

    const client = new RealTrackCaptainClient(ENV);
    await expect(client.convertTracking('TBA1', 'AMZL', { zip: '77044' })).rejects.toThrow(/Insufficient credits/);
    vi.unstubAllGlobals();
  });
});
