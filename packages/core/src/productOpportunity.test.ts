import { describe, expect, it } from 'vitest';
import { computeOpportunityScore } from './productOpportunity.js';

describe('computeOpportunityScore', () => {
  it('matches the original tool\'s reference formula for a known input', () => {
    // Ported 1:1 from the original Python compute_dropship_score, sanity-checked
    // against the same inputs: avg_price=$75, seller_count=10, total_sales=50, free_ship_pct=80.
    // price=min(75/5,20)=15; competition=max(0,20-10*0.5)=15; velocity=min(50/5,40)=10; shipping=80/5=16
    // total = 15+15+10+16 = 56
    const score = computeOpportunityScore({ avgPriceCents: 7500, uniqueSellers: 10, totalSold: 50, freeShippingPercent: 80 });
    expect(score).toBe(56);
  });

  it('scores a high-price, low-competition, high-velocity, all-free-shipping keyword near the top', () => {
    const score = computeOpportunityScore({ avgPriceCents: 10_000, uniqueSellers: 0, totalSold: 500, freeShippingPercent: 100 });
    expect(score).toBe(100);
  });

  it('scores a cheap, saturated, no-sales, no-free-shipping keyword at zero', () => {
    const score = computeOpportunityScore({ avgPriceCents: 0, uniqueSellers: 50, totalSold: 0, freeShippingPercent: 0 });
    expect(score).toBe(0);
  });

  it('caps the price component at $100 instead of rewarding ever-higher prices', () => {
    const at100 = computeOpportunityScore({ avgPriceCents: 10_000, uniqueSellers: 10, totalSold: 20, freeShippingPercent: 50 });
    const at1000 = computeOpportunityScore({ avgPriceCents: 100_000, uniqueSellers: 10, totalSold: 20, freeShippingPercent: 50 });
    expect(at1000).toBe(at100);
  });

  it('caps the velocity component at 200 sales instead of rewarding unlimited sales', () => {
    const at200 = computeOpportunityScore({ avgPriceCents: 5_000, uniqueSellers: 10, totalSold: 200, freeShippingPercent: 50 });
    const at2000 = computeOpportunityScore({ avgPriceCents: 5_000, uniqueSellers: 10, totalSold: 2000, freeShippingPercent: 50 });
    expect(at2000).toBe(at200);
  });

  it('never goes negative even with far more sellers than the competition scale expects', () => {
    const score = computeOpportunityScore({ avgPriceCents: 0, uniqueSellers: 500, totalSold: 0, freeShippingPercent: 0 });
    expect(score).toBe(0);
  });
});
