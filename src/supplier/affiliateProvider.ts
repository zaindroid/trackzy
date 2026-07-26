import type { SupplierMatch, SupplierProvider } from './types.js';

/**
 * STUB for the AliExpress Affiliate API provider (future primary). The Affiliate
 * API (`aliexpress.affiliate.product.query`) is a signed key/secret call with NO
 * per-result cost and NO CAPTCHA — once it's wired, swapping the primary is a
 * one-line change in index.ts (construct this instead of ApifyAliexpressProvider),
 * and the monthly Apify ceiling stops mattering.
 *
 * TODO(HUMAN): implement using src/aliexpress.ts's signing scaffold once you have
 * an approved AppKey/AppSecret; confirm the response shape against your API version.
 */
export class AffiliateSupplierProvider implements SupplierProvider {
  readonly source = 'aliexpress:affiliate';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async lookup(_query: string, _maxItems: number): Promise<{ match: SupplierMatch | null; resultsConsumed: number }> {
    throw new Error('AffiliateSupplierProvider not implemented yet — set up the AliExpress Affiliate API and wire it here.');
  }
}
