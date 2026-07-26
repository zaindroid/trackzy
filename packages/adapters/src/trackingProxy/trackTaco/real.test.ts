import { describe, expect, it, vi } from 'vitest';
import { RealTrackTacoClient } from './real.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ENV = { TRACKTACO_API_KEY: 'tt_live_test-key' };

describe('RealTrackTacoClient — search then reveal (real endpoint shapes, confirmed against live public API docs)', () => {
  it('searches by destination, then reveals the returned tn_id, mapping the carrier to a display label', async () => {
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          body: JSON.parse(init?.body as string),
          auth: (init?.headers as Record<string, string>)?.Authorization ?? null,
        });
        if (String(input).endsWith('/v2/tns/search')) {
          return jsonResponse({ searches: [{ results: [{ tn_id: 'tn_dhl_xyz', carrier: 'dhl' }], next_cursor: null, total: 1 }] });
        }
        return jsonResponse({ results: [{ tn_id: 'tn_dhl_xyz', outcome: 'revealed', tracking_number: '1234567890', carrier: 'dhl' }], credits_remaining: 10 });
      }),
    );

    const client = new RealTrackTacoClient(ENV);
    const result = await client.convertTracking('TBA1', 'AMZL', { city: 'Miami', state: 'FL', country: 'US' });

    expect(calls[0]?.url).toBe('https://v2.tracktaco.com/v2/tns/search');
    expect(calls[0]?.auth).toBe('Bearer tt_live_test-key');
    expect(calls[0]?.body).toMatchObject({ searches: [{ filter: { dest: { city: 'Miami', state: 'FL', country: 'US' } }, page_size: 5 }] });
    expect(calls[1]?.url).toBe('https://v2.tracktaco.com/v2/tns/reveal');
    expect(calls[1]?.body).toEqual({ tn_ids: ['tn_dhl_xyz'] });
    expect(result).toEqual({ proxyTracking: '1234567890', proxyCarrier: 'DHL' });
    vi.unstubAllGlobals();
  });

  it('sends origin.country matching destination.country, for a domestic-looking match regardless of the real supplier', async () => {
    let searchBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/v2/tns/search')) {
          searchBody = JSON.parse(init?.body as string);
          return jsonResponse({ searches: [{ results: [{ tn_id: 'tn_ups_de', carrier: 'ups' }], next_cursor: null, total: 1 }] });
        }
        return jsonResponse({ results: [{ tn_id: 'tn_ups_de', outcome: 'revealed', tracking_number: 'DE1234567890', carrier: 'ups' }], credits_remaining: 1 });
      }),
    );

    const client = new RealTrackTacoClient(ENV);
    await client.convertTracking('YT123', null as unknown as string, { city: 'Berlin', country: 'DE', originCountry: 'DE' });

    expect(searchBody).toMatchObject({ searches: [{ filter: { dest: { city: 'Berlin', country: 'DE' }, origin: { country: 'DE' } } }] });
    vi.unstubAllGlobals();
  });

  it('omits the origin filter entirely when no originCountry is given', async () => {
    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return jsonResponse({ searches: [{ results: [], next_cursor: null, total: 0 }] });
      }),
    );

    const client = new RealTrackTacoClient(ENV);
    await client.convertTracking('TBA1', 'AMZL', { city: 'Miami', country: 'US' }).catch(() => undefined);

    const body = capturedBody as { searches: { filter: { origin?: unknown } }[] };
    expect(body.searches[0]?.filter.origin).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('throws when search returns zero candidates', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ searches: [{ results: [], next_cursor: null, total: 0 }] })),
    );

    const client = new RealTrackTacoClient(ENV);
    await expect(client.convertTracking('TBA1', 'AMZL', { city: 'Nowhere' })).rejects.toThrow(/no candidates/);
    vi.unstubAllGlobals();
  });

  it('falls through to the next candidate when the first is already_revealed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith('/v2/tns/search')) {
          return jsonResponse({
            searches: [{ results: [{ tn_id: 'tn_a', carrier: 'ups' }, { tn_id: 'tn_b', carrier: 'ups' }], next_cursor: null, total: 2 }],
          });
        }
        return jsonResponse({
          results: [
            { tn_id: 'tn_a', outcome: 'already_revealed', error: { code: 'tn_already_revealed', message: 'claimed' } },
            { tn_id: 'tn_b', outcome: 'revealed', tracking_number: '9999', carrier: 'ups' },
          ],
          credits_remaining: 5,
        });
      }),
    );

    const client = new RealTrackTacoClient(ENV);
    const result = await client.convertTracking('TBA1', 'AMZL', { city: 'Reno' });
    expect(result).toEqual({ proxyTracking: '9999', proxyCarrier: 'UPS' });
    vi.unstubAllGlobals();
  });

  it('surfaces the structured error message on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ error: { code: 'insufficient_credits', message: 'Your balance is 0.', doc_url: 'https://...' } }, 402),
      ),
    );

    const client = new RealTrackTacoClient(ENV);
    await expect(client.convertTracking('TBA1', 'AMZL', { city: 'Reno' })).rejects.toThrow(/Your balance is 0/);
    vi.unstubAllGlobals();
  });
});
