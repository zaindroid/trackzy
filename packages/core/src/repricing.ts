/**
 * Pure repricing arithmetic (spec section 10). HARD RULE: no LLM anywhere in
 * this file — repricing is a money-path computation, exactly like
 * margin.ts's evaluateMargin.
 */
export interface RepricingInput {
  costCents: number;
  shippingCents: number;
  /** Flat estimated marketplace fee (a percentage of cost+shipping would double-count into the margin target; kept as a separate cents amount for simplicity). */
  feeCents: number;
  /** e.g. 20 for a 20% target margin. */
  targetMarginPercent: number;
  currentPriceCents: number;
  /** Only push a price update if the computed delta exceeds this percentage of the current price. */
  priceChangeThresholdPercent: number;
}

export interface RepricingResult {
  targetPriceCents: number;
  deltaPercent: number;
  shouldUpdate: boolean;
}

export function computeRepricing(input: RepricingInput): RepricingResult {
  const baseCents = input.costCents + input.shippingCents + input.feeCents;
  const marginFraction = input.targetMarginPercent / 100;
  const targetPriceCents = marginFraction >= 1 ? Infinity : Math.round(baseCents / (1 - marginFraction));

  const deltaPercent =
    input.currentPriceCents === 0
      ? Infinity
      : (Math.abs(targetPriceCents - input.currentPriceCents) / input.currentPriceCents) * 100;

  return {
    targetPriceCents,
    deltaPercent,
    shouldUpdate: deltaPercent >= input.priceChangeThresholdPercent,
  };
}

export interface StockSyncInput {
  offersInStock: boolean[];
}

/** Pauses a listing only when every known supplier offer for it is out of stock. */
export function shouldPauseForOutOfStock(input: StockSyncInput): boolean {
  return input.offersInStock.length > 0 && input.offersInStock.every((inStock) => !inStock);
}
