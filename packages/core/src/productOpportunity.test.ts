import { describe, expect, it } from 'vitest';
import { computeListingMargin, computeOpportunityScore, computeSourcingScore, decideReprice, sellThroughFactor } from './productOpportunity.js';

describe('decideReprice (smart auto-repricing brain)', () => {
  const base = {
    supplierCostCents: 500,
    inStock: true,
    currentSellPriceCents: 1899,
    competitorMedianCents: 1799,
    ebayFeePercent: 13.25,
    fulfillmentShippingCents: 0,
    minMarginPercent: 20,
    priceCeilingCents: null as number | null,
  };

  it('pauses when the supplier is out of stock', () => {
    expect(decideReprice({ ...base, inStock: false }).action).toBe('pause_oos');
  });

  it('lowers price to stay competitive but never below the margin floor', () => {
    const d = decideReprice(base);
    expect(d.action).toBe('reprice');
    expect(d.newSellPriceCents).toBe(1799); // follows the competitor median (well above floor)
    expect(d.marginPercent).toBeGreaterThanOrEqual(20);
  });

  it('raises price when supplier cost erodes the margin floor', () => {
    // Cost jumped to $16 → floor must rise well above the $17.99 competitor median.
    const d = decideReprice({ ...base, supplierCostCents: 1600, competitorMedianCents: 1799 });
    expect(d.action).toBe('reprice');
    expect(d.newSellPriceCents).toBeGreaterThan(1799); // margin floor wins over competitiveness
    expect(d.marginPercent).toBeGreaterThanOrEqual(20 - 0.5);
  });

  it('pauses as unprofitable when the floor exceeds the ceiling', () => {
    const d = decideReprice({ ...base, supplierCostCents: 1600, priceCeilingCents: 1999 });
    expect(d.action).toBe('pause_unprofitable');
  });

  it('does nothing when the price is already optimal', () => {
    // Already at the competitive price, healthy margin.
    const d = decideReprice({ ...base, currentSellPriceCents: 1799 });
    expect(d.action).toBe('none');
  });
});

describe('computeSourcingScore', () => {
  it('scores a strong product (high demand + fat margin + low competition + good price) near 100', () => {
    // 500 sold against only 50 active listings → sell-through ≥ 1 → full competition marks.
    expect(computeSourcingScore({ totalSold: 500, marginPercent: 80, medianPriceCents: 1500, activeListingCount: 50 })).toBeGreaterThanOrEqual(90);
  });

  it('keeps a decent low-competition product above the 70 gate', () => {
    // ~40 sold vs 40 active (STR 1), 60% margin, $20 → clears 70.
    expect(computeSourcingScore({ totalSold: 40, marginPercent: 60, medianPriceCents: 2000, activeListingCount: 40 })).toBeGreaterThanOrEqual(70);
  });

  it('DROPS a saturated niche below the gate even with identical demand + margin', () => {
    // Same 40 sold / 60% margin / $20, but 4000 active listings → STR 0.01 → a
    // bloodbath. This is the whole point of the competition term.
    const goldmine = computeSourcingScore({ totalSold: 40, marginPercent: 60, medianPriceCents: 2000, activeListingCount: 40 });
    const bloodbath = computeSourcingScore({ totalSold: 40, marginPercent: 60, medianPriceCents: 2000, activeListingCount: 4000 });
    expect(bloodbath).toBeLessThan(goldmine);
    expect(bloodbath).toBeLessThan(70);
  });

  it('treats thin/absent competition data as neutral (no free boost, no penalty)', () => {
    // No activeListingCount, and a sub-sample sold count → neutral half competition.
    const neutral = computeSourcingScore({ totalSold: 40, marginPercent: 60, medianPriceCents: 2000 });
    const full = computeSourcingScore({ totalSold: 40, marginPercent: 60, medianPriceCents: 2000, activeListingCount: 40 });
    const none = computeSourcingScore({ totalSold: 40, marginPercent: 60, medianPriceCents: 2000, activeListingCount: 400000 });
    expect(neutral).toBeGreaterThan(none);
    expect(neutral).toBeLessThan(full);
  });

  it('does not let a tiny sample (2 sold / 1 active = 200%) dominate — min-sample guard', () => {
    // Below the min-sample thresholds → neutral, NOT a full-competition boost.
    expect(sellThroughFactor(2, 1)).toBeNull();
    expect(computeSourcingScore({ totalSold: 2, marginPercent: 60, medianPriceCents: 2000, activeListingCount: 1 })).toBeLessThan(70);
  });

  it('drops a thin-margin low-demand product below the gate', () => {
    expect(computeSourcingScore({ totalSold: 5, marginPercent: 25, medianPriceCents: 900 })).toBeLessThan(70);
  });

  it('never exceeds 100 and treats negative margin as zero', () => {
    expect(computeSourcingScore({ totalSold: 100000, marginPercent: 300, medianPriceCents: 2000, activeListingCount: 10 })).toBe(100);
    expect(computeSourcingScore({ totalSold: 0, marginPercent: -50, medianPriceCents: 0 })).toBeGreaterThanOrEqual(0);
  });
});

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

describe('computeListingMargin', () => {
  it('computes profit after supplier cost, eBay fee, and shipping', () => {
    // Sell $25.00, cost $6.00, 13.25% fee ($3.31 → 331¢), $2.00 shipping.
    // margin = 2500 - 600 - 331 - 200 = 1369
    const { marginCents, marginPercent } = computeListingMargin({
      sellPriceCents: 2500,
      supplierCostCents: 600,
      ebayFeePercent: 13.25,
      fulfillmentShippingCents: 200,
    });
    expect(marginCents).toBe(1369);
    expect(marginPercent).toBe(54.8);
  });

  it('goes negative when the item cannot be sold profitably at that price', () => {
    const { marginCents } = computeListingMargin({
      sellPriceCents: 500,
      supplierCostCents: 600,
      ebayFeePercent: 13.25,
      fulfillmentShippingCents: 200,
    });
    expect(marginCents).toBeLessThan(0);
  });

  it('returns 0% margin for a zero sell price rather than dividing by zero', () => {
    const { marginPercent } = computeListingMargin({ sellPriceCents: 0, supplierCostCents: 100, ebayFeePercent: 13, fulfillmentShippingCents: 0 });
    expect(marginPercent).toBe(0);
  });
});
