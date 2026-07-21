import type { MarginInput, MarginResult } from './types.js';

/**
 * Pure arithmetic. HARD RULE: no LLM, no network, no I/O in this module — the
 * entire pricing/margin path must be auditable as plain TypeScript.
 */
export function evaluateMargin(input: MarginInput): MarginResult {
  const marginCents = input.subtotalCents - input.supplierCostCents - input.shippingCents;
  const marginPercent = input.subtotalCents === 0 ? 0 : (marginCents / input.subtotalCents) * 100;

  const meetsThreshold =
    input.marginMode === 'absolute'
      ? marginCents >= input.minMarginCents
      : marginPercent >= input.minMarginPercent;

  return { marginCents, marginPercent, meetsThreshold };
}
