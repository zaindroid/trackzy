import { describe, expect, it, vi } from 'vitest';
import { RealGeminiExtractor } from './real.js';
import type { GeminiEnv } from './iface.js';

const ENV: GeminiEnv = { GEMINI_API_KEY: 'gemini-key-1', GROQ_API_KEY: 'groq-key-1' };

function groqResponse(content: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status });
}

describe('RealGeminiExtractor — chat/JSON call sites run on Groq', () => {
  it('sends a structured-output request to Groq\'s OpenAI-compatible endpoint, not Gemini', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = init?.headers as Record<string, string>;
        capturedBody = JSON.parse(init?.body as string);
        return groqResponse({ subject: 'Claim', body: 'Please investigate.' });
      }),
    );

    const extractor = new RealGeminiExtractor(ENV);
    const result = await extractor.draftDispute({ reason: 'lost package', trackingNumber: '1Z999' });

    expect(capturedUrl).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(capturedHeaders?.Authorization).toBe('Bearer groq-key-1');
    expect(capturedBody?.model).toBe('openai/gpt-oss-120b');
    expect((capturedBody?.response_format as { type: string })?.type).toBe('json_schema');
    expect(result).toEqual({ subject: 'Claim', body: 'Please investigate.' });

    vi.unstubAllGlobals();
  });

  it('picks a candidate by id from pickBestListingMatch, or null when Groq says "none"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => groqResponse({ chosenId: 'none', confidence: 0.95 })));

    const extractor = new RealGeminiExtractor(ENV);
    const result = await extractor.pickBestListingMatch({
      targetTitle: 'Silk Eye Mask',
      candidates: [{ id: 'p1', title: 'Jellyfish Toy' }],
    });

    expect(result).toEqual({ chosenId: null, confidence: 0.95 });
    vi.unstubAllGlobals();
  });

  it('respects a custom GROQ_MODEL override', async () => {
    let capturedModel: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedModel = JSON.parse(init?.body as string).model;
        return groqResponse({ category: 'in_transit', isStuckOrLost: false });
      }),
    );

    const extractor = new RealGeminiExtractor({ ...ENV, GROQ_MODEL: 'qwen/qwen3.6-27b' });
    await extractor.classifyTrackingException('in transit to destination');

    expect(capturedModel).toBe('qwen/qwen3.6-27b');
    vi.unstubAllGlobals();
  });

  it('throws with Groq\'s error body on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));

    const extractor = new RealGeminiExtractor(ENV);
    await expect(extractor.suggestListingTitle({ currentTitle: 'Widget' })).rejects.toThrow(/Groq request failed: 429/);

    vi.unstubAllGlobals();
  });

  it('suggestRefinedKeywords returns the plain keyword array from the structured response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => groqResponse({ keywords: ['silk eye mask travel size', 'silk eye mask for migraines'] })));

    const extractor = new RealGeminiExtractor(ENV);
    const keywords = await extractor.suggestRefinedKeywords({ seedKeyword: 'silk eye mask', currentScore: 35, sampleTitles: ['Silk Eye Mask'] });

    expect(keywords).toEqual(['silk eye mask travel size', 'silk eye mask for migraines']);
    vi.unstubAllGlobals();
  });

  it('analyzeOpportunity returns the full verdict/pricing/risk structure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        groqResponse({
          verdict: 'Worth listing — solid margin, low competition.',
          sellPriceMinCents: 1500,
          sellPriceMaxCents: 2500,
          targetSourcePriceCents: 600,
          marginEstimateCents: 1400,
          risk: 'Seasonal demand.',
          recommendedKeywords: ['silk eye mask gift set'],
        }),
      ),
    );

    const extractor = new RealGeminiExtractor(ENV);
    const result = await extractor.analyzeOpportunity({
      keyword: 'silk eye mask',
      avgPriceCents: 2000,
      totalSold: 40,
      uniqueSellers: 8,
      freeShippingPercent: 60,
    });

    expect(result.verdict).toContain('Worth listing');
    expect(result.marginEstimateCents).toBe(1400);
    expect(result.recommendedKeywords).toEqual(['silk eye mask gift set']);
    vi.unstubAllGlobals();
  });
});

describe('RealGeminiExtractor.embedText — still Gemini, unaffected by the Groq migration', () => {
  it('calls Gemini\'s embedContent endpoint, not Groq', async () => {
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } }), { status: 200 });
      }),
    );

    const extractor = new RealGeminiExtractor(ENV);
    const result = await extractor.embedText('silk eye mask');

    expect(capturedUrl).toContain('generativelanguage.googleapis.com');
    expect(capturedUrl).toContain('gemini-embedding-001');
    expect(result).toEqual([0.1, 0.2, 0.3]);

    vi.unstubAllGlobals();
  });
});
