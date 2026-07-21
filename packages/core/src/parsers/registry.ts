import type { EmailParser } from './types.js';
import { parseAcmeSupply } from './acmeSupply.js';
import { parseGlobexGoods } from './globexGoods.js';

export const parserRegistry: Record<string, EmailParser> = {
  'acme-supply-v1': parseAcmeSupply,
  'globex-goods-v1': parseGlobexGoods,
};

export function getParser(parserId: string): EmailParser | undefined {
  return parserRegistry[parserId];
}
