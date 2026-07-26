import type { EmailParser } from './types.js';
import { parseAcmeSupply } from './acmeSupply.js';
import { parseGlobexGoods } from './globexGoods.js';
import { parseAmazonRetail } from './amazonRetail.js';
import { parseAliExpressShipping } from './aliexpressShipping.js';
import { parseGenericFallback } from './genericFallback.js';

export const parserRegistry: Record<string, EmailParser> = {
  'acme-supply-v1': parseAcmeSupply,
  'globex-goods-v1': parseGlobexGoods,
  'amazon-retail-manual-v1': parseAmazonRetail,
  'aliexpress-v1': parseAliExpressShipping,
  'generic-fallback-v1': parseGenericFallback,
};

export function getParser(parserId: string): EmailParser | undefined {
  return parserRegistry[parserId];
}
