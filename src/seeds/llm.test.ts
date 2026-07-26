import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateNiches } from './llm.js';

afterEach(() => vi.unstubAllGlobals());

describe('generateNiches', () => {
  it('returns [] and makes no call when no apiKey (caller falls back to seeds.json)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await generateNiches({ apiKey: undefined, model: 'm', count: 6, themes: [] })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('parses the Groq JSON, dedupes case-insensitively, and caps to count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    niches: ['Magnetic Vent Car Phone Mount', 'magnetic vent car phone mount', 'Silicone Dog Lick Mat', 'LED Closet Motion Light'],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const out = await generateNiches({ apiKey: 'gsk_test', model: 'm', count: 2, themes: ['auto', 'pet'] });
    expect(out).toEqual(['Magnetic Vent Car Phone Mount', 'Silicone Dog Lick Mat']); // dup dropped, capped at 2
  });

  it('throws on a Groq error status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    await expect(generateNiches({ apiKey: 'gsk_test', model: 'm', count: 6, themes: [] })).rejects.toThrow(/Groq 429/);
  });
});
