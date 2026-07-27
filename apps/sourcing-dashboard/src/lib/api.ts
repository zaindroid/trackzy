export interface ConnectionStatus {
  ebayConnected: boolean;
  cjConnected: boolean;
  aliexpressAvailable: boolean;
}

export type SourcingProvider = 'aliexpress' | 'cj';

export interface SellerSettings {
  userId: string;
  defaultShippingCostCents: number;
  handlingTimeDays: number;
  returnPolicy: 'no_returns' | '30_day' | '60_day';
  targetMarginPercent: number;
  ebayFeePercent: number;
  itemLocationPostalCode: string;
}

export interface ProductCandidate {
  id: string;
  keyword: string;
  ebayAvgSoldPriceCents: number;
  ebayMedianPriceCents: number;
  ebaySoldCount: number;
  supplierProvider: string;
  supplierProductId: string;
  supplierCostCents: number;
  supplierProductUrl: string | null;
  supplierImageUrls: string[];
  marginCents: number;
  marginPercent: number;
  opportunityScore: number;
  suggestedSellPriceCents: number;
  generatedTitle: string;
  generatedDescription: string;
  generatedAspects: Record<string, string>;
  categoryId: string | null;
  status: 'draft' | 'listed' | 'dismissed';
  ebayItemId: string | null;
  createdAt: number;
}

export interface RadarProduct {
  id: string;
  niche: string;
  productTitle: string;
  imageUrl: string | null;
  ebaySoldCount: number;
  salesPerDay: number;
  ebayActiveCount: number;
  sellThroughPercent: number;
  ebayMedianSoldPriceCents: number;
  aliexpressProductId: string | null;
  aliexpressUrl: string | null;
  aliexpressCostCents: number | null;
  aliexpressRating: number | null;
  aliexpressOrders: number | null;
  sourceable: boolean;
  supplierCheck: 'ok' | 'pending' | 'none';
  marginCents: number;
  marginPercent: number;
  opportunityScore: number;
  lastUpdated: number;
}

export interface CreditLedgerEntry {
  id: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  createdAt: number;
}

export interface CreditsResponse {
  balance: number;
  costs: Record<string, number>;
  ledger: CreditLedgerEntry[];
}

export interface LibraryWinner {
  id: string;
  productTitle: string;
  imageUrl: string | null;
  blurred: boolean;
  ebaySoldCount: number;
  ebayMedianPriceCents: number;
  marginCents: number;
  marginPercent: number;
  score: number;
  unlocked: boolean;
}

export interface LibraryResponse {
  access: boolean;
  winners: LibraryWinner[];
}

export interface LeaderboardWinner {
  id: string;
  productTitle: string;
  imageUrl: string | null;
  score: number;
  scoreDelta: number;
  spark: number[];
  ebaySoldCount: number;
  marginCents: number;
  marginPercent: number;
  timesUnlocked: number;
  isNew: boolean;
}

export interface ListingMonitor {
  candidateId: string;
  title: string;
  imageUrl: string | null;
  ebayItemId: string | null;
  enabled: boolean;
  health: 'healthy' | 'warning' | 'critical' | 'paused';
  stockStatus: 'in' | 'low' | 'out';
  minMarginPercent: number;
  priceCeilingCents: number | null;
  currentSellPriceCents: number | null;
  currentSupplierCostCents: number | null;
  currentMarginPercent: number | null;
  lastAction: string | null;
  lastReason: string | null;
  lastCheckedAt: number | null;
  marginSpark: number[];
}

/** A fulfillment order from the trackzy worker (cross-origin, same Clerk token). */
export interface TrackzyOrder {
  id: string;
  externalOrderNumber: string;
  status: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  marginCents: number | null;
  createdAt: number;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * A bearer token, or (preferred) an async getter that returns a *fresh* one.
 * Clerk session tokens live ~60s, so passing the getter lets every request mint
 * a current token at call time instead of reusing a cached (possibly expired)
 * one — which otherwise surfaces as "Missing or invalid session".
 */
export type TokenSource = string | null | (() => Promise<string | null>);

export async function apiFetch<T>(path: string, token: TokenSource, init?: RequestInit): Promise<T> {
  const bearer = typeof token === 'function' ? await token() : token;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// The trackzy (fulfillment) worker's API base — same Clerk token works there
// (shared Clerk app). Configurable; defaults to the deployed trackzy worker.
export const TRACKZY_API_BASE = (import.meta.env.VITE_TRACKZY_API_BASE as string | undefined) ?? 'https://fulfillment-tracker.zainey4-26a.workers.dev';

/** Calls the trackzy worker cross-origin (its /api/* has permissive CORS). Used
 * to surface fulfillment (Orders) inside the unified Zearch dashboard. */
export async function trackzyFetch<T>(path: string, token: TokenSource, init?: RequestInit): Promise<T> {
  const bearer = typeof token === 'function' ? await token() : token;
  const res = await fetch(`${TRACKZY_API_BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
