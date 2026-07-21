import type { Carrier } from '../types.js';

export function normalizeCarrierName(raw: string | undefined | null): Carrier | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toUpperCase();
  if (v.includes('UPS')) return 'UPS';
  if (v.includes('USPS')) return 'USPS';
  if (v.includes('FEDEX') || v.includes('FED EX')) return 'FEDEX';
  if (v.includes('DHL')) return 'DHL';
  return undefined;
}
