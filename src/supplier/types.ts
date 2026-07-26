import type { SupplierMatch } from '../types.js';

export type { SupplierMatch };

export type SupplierCheck = 'ok' | 'pending' | 'none';

/** A survivor handed to the supplier layer. `id` is opaque to us (the caller's
 * ref); `query` is the raw supplier search string we normalize. */
export interface SupplierQuery {
  id: string;
  query: string;
}

export interface SupplierResolution {
  match: SupplierMatch | null;
  /** 'ok' = checked (found or not); 'pending' = deferred by the monthly budget. */
  supplierCheck: SupplierCheck;
  normalizedKey: string;
}

/**
 * A pluggable supplier source. Swap the primary by constructing a different
 * implementation — the orchestrator is provider-agnostic. `resultsConsumed` is
 * how many billable results this lookup actually cost (drives the ceiling).
 */
export interface SupplierProvider {
  readonly source: string;
  lookup(normalizedQuery: string, maxItems: number): Promise<{ match: SupplierMatch | null; resultsConsumed: number }>;
}

/** Talks to the portal's token-authed cache/budget endpoints (D1-backed). */
export interface CacheClient {
  lookup(keys: string[], ttlDays: number): Promise<{ hits: Record<string, { match: SupplierMatch | null }>; monthUsage: number }>;
  store(entries: { key: string; match: SupplierMatch | null; resultsConsumed: number }[]): Promise<{ monthUsage: number }>;
}

export interface SupplierConfig {
  topN: number;
  ttlDays: number;
  maxItems: number;
  monthlyBudget: number;
}
