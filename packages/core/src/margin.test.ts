import { describe, expect, it } from 'vitest';
import { evaluateMargin } from './margin.js';

describe('evaluateMargin', () => {
  it('computes margin as subtotal - supplierCost - shipping', () => {
    const result = evaluateMargin({
      subtotalCents: 10000,
      shippingCents: 500,
      supplierCostCents: 6000,
      minMarginCents: 200,
      marginMode: 'absolute',
      minMarginPercent: 10,
    });
    expect(result.marginCents).toBe(3500);
    expect(result.meetsThreshold).toBe(true);
  });

  it('rejects when margin is below the absolute threshold', () => {
    const result = evaluateMargin({
      subtotalCents: 10000,
      shippingCents: 500,
      supplierCostCents: 9400,
      minMarginCents: 200,
      marginMode: 'absolute',
      minMarginPercent: 10,
    });
    expect(result.marginCents).toBe(100);
    expect(result.meetsThreshold).toBe(false);
  });

  it('accepts exactly at the absolute threshold boundary', () => {
    const result = evaluateMargin({
      subtotalCents: 10000,
      shippingCents: 500,
      supplierCostCents: 9300,
      minMarginCents: 200,
      marginMode: 'absolute',
      minMarginPercent: 10,
    });
    expect(result.marginCents).toBe(200);
    expect(result.meetsThreshold).toBe(true);
  });

  it('evaluates percent mode against marginPercent of subtotal', () => {
    const result = evaluateMargin({
      subtotalCents: 10000,
      shippingCents: 0,
      supplierCostCents: 8500,
      minMarginCents: 0,
      marginMode: 'percent',
      minMarginPercent: 20,
    });
    expect(result.marginPercent).toBeCloseTo(15, 5);
    expect(result.meetsThreshold).toBe(false);
  });

  it('handles negative margin (supplier cost exceeds subtotal)', () => {
    const result = evaluateMargin({
      subtotalCents: 5000,
      shippingCents: 500,
      supplierCostCents: 6000,
      minMarginCents: 0,
      marginMode: 'absolute',
      minMarginPercent: 0,
    });
    expect(result.marginCents).toBe(-1500);
    expect(result.meetsThreshold).toBe(false);
  });

  it('guards against divide-by-zero when subtotal is zero', () => {
    const result = evaluateMargin({
      subtotalCents: 0,
      shippingCents: 0,
      supplierCostCents: 0,
      minMarginCents: 0,
      marginMode: 'percent',
      minMarginPercent: 10,
    });
    expect(result.marginPercent).toBe(0);
    expect(result.meetsThreshold).toBe(false);
  });
});
