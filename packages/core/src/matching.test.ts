import { describe, expect, it } from 'vitest';
import { matchByExactSkuOrFuzzyTitle, matchByEmbedding, topCandidatesForLlm } from './matching.js';

describe('matchByExactSkuOrFuzzyTitle', () => {
  it('matches on exact SKU when exactly one candidate shares it', () => {
    const result = matchByExactSkuOrFuzzyTitle(
      { sku: 'widget-red-l', title: 'Widget Red Large' },
      [
        { supplierProductId: 'p1', title: 'Something unrelated', sku: 'WIDGET-RED-L' },
        { supplierProductId: 'p2', title: 'Another unrelated item', sku: 'OTHER-SKU' },
      ],
    );
    expect(result).toEqual({ supplierProductId: 'p1', confidence: 1, source: 'exact_sku' });
  });

  it('normalizes SKU casing/whitespace before comparing', () => {
    const result = matchByExactSkuOrFuzzyTitle(
      { sku: ' Widget-Red-L ', title: 'Widget Red Large' },
      [{ supplierProductId: 'p1', title: 'irrelevant', sku: 'WIDGET-RED-L' }],
    );
    expect(result?.source).toBe('exact_sku');
  });

  it('falls through to fuzzy title matching when no SKU matches', () => {
    const result = matchByExactSkuOrFuzzyTitle(
      { sku: 'no-such-sku', title: 'Widget - Red / Large' },
      [
        { supplierProductId: 'p1', title: 'Widget Red Large 2', sku: 'DIFFERENT-SKU' },
        { supplierProductId: 'p2', title: 'Completely different gizmo', sku: 'ANOTHER-SKU' },
      ],
    );
    expect(result).toEqual({ supplierProductId: 'p1', confidence: expect.any(Number), source: 'fuzzy_title' });
    expect(result!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('returns null (escalates) when multiple SKUs match ambiguously', () => {
    const result = matchByExactSkuOrFuzzyTitle(
      { sku: 'AMBIG-SKU', title: 'Widget' },
      [
        { supplierProductId: 'p1', title: 'A', sku: 'AMBIG-SKU' },
        { supplierProductId: 'p2', title: 'B', sku: 'AMBIG-SKU' },
      ],
    );
    expect(result).toBeNull();
  });

  it('returns null when the best fuzzy match is below the 0.9 threshold', () => {
    const result = matchByExactSkuOrFuzzyTitle(
      { sku: 'no-match', title: 'Widget Red Large' },
      [{ supplierProductId: 'p1', title: 'Totally different product name', sku: 'OTHER' }],
    );
    expect(result).toBeNull();
  });

  it('returns null when the top two fuzzy candidates are too close to call', () => {
    const result = matchByExactSkuOrFuzzyTitle(
      { sku: 'no-match', title: 'Widget Red Large' },
      [
        { supplierProductId: 'p1', title: 'Widget Red Large 2', sku: 'A' },
        { supplierProductId: 'p2', title: 'Widget Red Large 3', sku: 'B' },
      ],
    );
    expect(result).toBeNull();
  });
});

describe('matchByEmbedding', () => {
  it('picks the highest-similarity candidate above the threshold when unambiguous', () => {
    const result = matchByEmbedding([
      { candidate: { supplierProductId: 'p1', title: 'A' }, similarity: 0.92 },
      { candidate: { supplierProductId: 'p2', title: 'B' }, similarity: 0.4 },
    ]);
    expect(result).toEqual({ supplierProductId: 'p1', confidence: 0.92, source: 'embedding' });
  });

  it('returns null below the embedding threshold', () => {
    const result = matchByEmbedding([{ candidate: { supplierProductId: 'p1', title: 'A' }, similarity: 0.5 }]);
    expect(result).toBeNull();
  });

  it('returns null when the top two are too close to call, escalating to the LLM stage', () => {
    const result = matchByEmbedding([
      { candidate: { supplierProductId: 'p1', title: 'A' }, similarity: 0.9 },
      { candidate: { supplierProductId: 'p2', title: 'B' }, similarity: 0.89 },
    ]);
    expect(result).toBeNull();
  });
});

describe('topCandidatesForLlm', () => {
  it('returns the top N candidates sorted by similarity, defaulting to 5', () => {
    const scored = Array.from({ length: 8 }, (_, i) => ({
      candidate: { supplierProductId: `p${i}`, title: `title ${i}` },
      similarity: i / 10,
    }));
    const top = topCandidatesForLlm(scored);
    expect(top).toHaveLength(5);
    expect(top[0]?.supplierProductId).toBe('p7'); // highest similarity first
  });

  it('respects a custom limit', () => {
    const scored = [
      { candidate: { supplierProductId: 'p1', title: 'a' }, similarity: 0.9 },
      { candidate: { supplierProductId: 'p2', title: 'b' }, similarity: 0.8 },
    ];
    expect(topCandidatesForLlm(scored, 1)).toHaveLength(1);
  });
});
