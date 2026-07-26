import type { Carrier } from './types.js';

/**
 * Carriers eBay natively recognizes and validates tracking numbers against
 * (its Valid Tracking Rate policy). Anything else — Amazon Logistics
 * (`TBA...`), or an AliExpress/Temu supplier's own carrier (Cainiao,
 * YunExpress, 4PX, ...) which this codebase's carrier-detection chain
 * doesn't even have a `Carrier` enum value for and so always resolves to
 * `null` — gets flagged by eBay as an invalid/unrecognized carrier and
 * triggers policy defects, not just Amazon's.
 */
const EBAY_RECOGNIZED_CARRIERS: ReadonlySet<Carrier> = new Set(['UPS', 'USPS', 'FEDEX', 'DHL']);

/**
 * Pure decision logic for the tracking-conversion hard rule (spec section 7):
 * "When a tracking number eBay won't natively recognize is detected for an
 * eBay destination, you MUST route it through a tracking proxy." Originally
 * scoped to just Amazon Logistics (`carrierFinal === 'AMZL'`), but the same
 * problem applies to every other manual supplier this system fulfills from
 * (AliExpress, Temu, ...) — their tracking numbers aren't AMZL, they're
 * *unrecognized entirely* (`carrierFinal === null`), which is exactly as
 * unsafe to upload to eBay raw. Kept as its own tiny, explicitly-tested
 * function — not inlined into the middleware — specifically because spec
 * section 11 calls out "asserting TBA goes to proxy, USPS goes straight
 * through" as a required test, and a one-line carrier check buried inside a
 * larger orchestration function would be easy to silently break without a
 * test pinned directly to it.
 */
export function shouldRouteThroughTrackingProxy(carrierFinal: Carrier | null, destinationPlatform: string): boolean {
  if (destinationPlatform !== 'ebay') return false;
  return carrierFinal === null || !EBAY_RECOGNIZED_CARRIERS.has(carrierFinal);
}
