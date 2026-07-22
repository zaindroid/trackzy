import type { Carrier } from './types.js';

/**
 * Pure decision logic for the tracking-conversion hard rule (spec section 7):
 * "When an Amazon logistics tracking number is detected for an eBay
 * destination, you MUST route it through a tracking proxy API." Kept as its
 * own tiny, explicitly-tested function — not inlined into the middleware —
 * specifically because spec section 11 calls out "asserting TBA goes to
 * proxy, USPS goes straight through" as a required test, and a one-line
 * `carrier === 'AMZL'` check buried inside a larger orchestration function
 * would be easy to silently break without a test pinned directly to it.
 */
export function shouldRouteThroughTrackingProxy(carrierFinal: Carrier | null, destinationPlatform: string): boolean {
  return carrierFinal === 'AMZL' && destinationPlatform === 'ebay';
}
