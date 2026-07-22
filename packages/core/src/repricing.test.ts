import { describe, expect, it } from 'vitest';
import { computeRepricing, shouldPauseForOutOfStock } from './repricing.js';

describe('computeRepricing', () => {
  it('computes target price as (cost + shipping + fee) / (1 - targetMargin)', () => {
    const result = computeRepricing({
      costCents: 3000,
      shippingCents: 500,
      feeCents: 200,
      targetMarginPercent: 20,
      currentPriceCents: 5000,
      priceChangeThresholdPercent: 5,
    });
    // (3000 + 500 + 200) / 0.8 = 4625
    expect(result.targetPriceCents).toBe(4625);
  });

  it('flags shouldUpdate when the delta exceeds the threshold', () => {
    const result = computeRepricing({
      costCents: 3000,
      shippingCents: 500,
      feeCents: 200,
      targetMarginPercent: 20,
      currentPriceCents: 5000,
      priceChangeThresholdPercent: 5,
    });
    // delta = |4625 - 5000| / 5000 * 100 = 7.5% >= 5% threshold
    expect(result.deltaPercent).toBeCloseTo(7.5, 5);
    expect(result.shouldUpdate).toBe(true);
  });

  it('does not flag shouldUpdate when the delta is within the threshold', () => {
    const result = computeRepricing({
      costCents: 3000,
      shippingCents: 500,
      feeCents: 200,
      targetMarginPercent: 20,
      currentPriceCents: 4650, // close to the 4625 target
      priceChangeThresholdPercent: 5,
    });
    expect(result.shouldUpdate).toBe(false);
  });

  it('treats a zero current price as an infinite delta (always update)', () => {
    const result = computeRepricing({
      costCents: 3000,
      shippingCents: 0,
      feeCents: 0,
      targetMarginPercent: 20,
      currentPriceCents: 0,
      priceChangeThresholdPercent: 5,
    });
    expect(result.shouldUpdate).toBe(true);
    expect(result.deltaPercent).toBe(Infinity);
  });

  it('handles a zero target margin (target price equals cost basis)', () => {
    const result = computeRepricing({
      costCents: 3000,
      shippingCents: 500,
      feeCents: 200,
      targetMarginPercent: 0,
      currentPriceCents: 3700,
      priceChangeThresholdPercent: 5,
    });
    expect(result.targetPriceCents).toBe(3700);
    expect(result.shouldUpdate).toBe(false);
  });
});

describe('shouldPauseForOutOfStock', () => {
  it('pauses when every offer is out of stock', () => {
    expect(shouldPauseForOutOfStock({ offersInStock: [false, false] })).toBe(true);
  });

  it('does not pause when at least one offer is in stock', () => {
    expect(shouldPauseForOutOfStock({ offersInStock: [false, true] })).toBe(false);
  });

  it('does not pause when there are no known offers at all', () => {
    expect(shouldPauseForOutOfStock({ offersInStock: [] })).toBe(false);
  });
});
