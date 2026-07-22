import { describe, expect, it } from 'vitest';
import { diceCoefficient, fuzzyTitleSimilarity, normalizeTitle } from './fuzzyMatch.js';

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeTitle('Widget - Red / Large!!')).toBe('widget red large');
  });

  it('is idempotent', () => {
    const once = normalizeTitle('Gadget  Blue,  Medium.');
    expect(normalizeTitle(once)).toBe(once);
  });
});

describe('diceCoefficient', () => {
  it('is 1 for identical strings', () => {
    expect(diceCoefficient('widget red large', 'widget red large')).toBe(1);
  });

  it('is 0 for completely dissimilar strings', () => {
    expect(diceCoefficient('aaaa', 'zzzz')).toBe(0);
  });

  it('scores near-identical strings very highly', () => {
    const score = diceCoefficient('widget red large', 'widget red large v2');
    expect(score).toBeGreaterThan(0.85);
  });

  it('scores unrelated product titles low', () => {
    const score = diceCoefficient('widget red large', 'gizmo green small');
    expect(score).toBeLessThan(0.3);
  });

  it('is symmetric', () => {
    expect(diceCoefficient('widget red', 'red widget')).toBe(diceCoefficient('red widget', 'widget red'));
  });
});

describe('fuzzyTitleSimilarity', () => {
  it('normalizes before comparing, so punctuation/casing differences do not hurt the score', () => {
    const score = fuzzyTitleSimilarity('Widget - Red / Large', 'widget red large');
    expect(score).toBe(1);
  });

  it('clears the spec-mandated 0.9 threshold for a near-exact listing/product title pair', () => {
    const score = fuzzyTitleSimilarity('Widget - Red / Large', 'Widget Red Large 2');
    expect(score).toBeGreaterThanOrEqual(0.9);
  });

  it('falls below the 0.9 threshold once the titles diverge by more than a couple of characters', () => {
    const score = fuzzyTitleSimilarity('Widget - Red / Large', 'Widget Red Large (Genuine)');
    expect(score).toBeLessThan(0.9);
  });
});
