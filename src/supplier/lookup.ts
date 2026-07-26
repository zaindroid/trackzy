import { normalizeQuery } from './normalize.js';
import type { CacheClient, SupplierConfig, SupplierProvider, SupplierQuery, SupplierResolution } from './types.js';

export interface SupplierDeps {
  provider: SupplierProvider;
  cache: CacheClient;
  config: SupplierConfig;
}

/**
 * Resolves suppliers for a set of already-scored SURVIVORS, spending Apify
 * credit as rarely as possible. Credit-conservation layers, in order:
 *
 *   1. Survivor-only gate — hard-capped at config.topN (never the broad universe).
 *   2. Normalize + dedupe — equivalent queries share one key, one lookup, one pay.
 *   3. D1 cache with TTL — fresh cached keys make ZERO Apify calls.
 *   4. Low maxItems — only config.maxItems results requested per call.
 *   5. Monthly ceiling — once month usage would exceed config.monthlyBudget,
 *      remaining misses are marked 'pending' (never called) and still flow on.
 *
 * Returns a resolution per input id. Budget-deferred survivors get
 * supplierCheck:'pending' so the caller posts them as "demand strong, supplier
 * not yet checked" rather than dropping them.
 */
export async function resolveSuppliers(survivors: SupplierQuery[], deps: SupplierDeps): Promise<Map<string, SupplierResolution>> {
  const { provider, cache, config } = deps;

  // Layer 1: survivor-only gate. This module physically refuses more than topN.
  const capped = survivors.slice(0, config.topN);
  if (survivors.length > config.topN) {
    console.warn(`[supplier] capped ${survivors.length} → ${config.topN} survivors (TOP_N_SURVIVORS)`);
  }

  // Layer 2: normalize + dedupe. Map each id to its normalized key; build the
  // set of unique keys we might actually pay for.
  const keyById = new Map<string, string>();
  for (const s of capped) keyById.set(s.id, normalizeQuery(s.query));
  const uniqueKeys = [...new Set(keyById.values())];

  // Layer 3: cache lookup (one round trip). Fresh hits cost nothing.
  const { hits, monthUsage } = await cache.lookup(uniqueKeys, config.ttlDays);
  const resolvedByKey = new Map<string, { match: SupplierResolution['match']; supplierCheck: 'ok' | 'pending' }>();
  for (const [key, hit] of Object.entries(hits)) {
    resolvedByKey.set(key, { match: hit.match, supplierCheck: 'ok' });
  }

  // Layers 4 + 5: resolve cache misses via the provider, honoring the ceiling.
  const misses = uniqueKeys.filter((k) => !resolvedByKey.has(k));
  const storeEntries: { key: string; match: SupplierResolution['match']; resultsConsumed: number }[] = [];
  let runningUsage = monthUsage;

  for (const key of misses) {
    // Pre-check the ceiling with the REQUESTED size (conservative). Once we'd
    // cross the budget, stop calling — mark this and every remaining miss pending.
    if (runningUsage + config.maxItems > config.monthlyBudget) {
      console.warn(`[supplier] monthly budget reached (${runningUsage}/${config.monthlyBudget}) — deferring "${key}" and the rest to pending`);
      resolvedByKey.set(key, { match: null, supplierCheck: 'pending' });
      continue;
    }
    try {
      const { match, resultsConsumed } = await provider.lookup(key, config.maxItems);
      runningUsage += resultsConsumed;
      resolvedByKey.set(key, { match, supplierCheck: 'ok' });
      storeEntries.push({ key, match, resultsConsumed });
    } catch (err) {
      // A failed lookup is not a paid result; leave it pending to retry next run.
      console.warn(`[supplier] lookup failed for "${key}":`, err instanceof Error ? err.message : err);
      resolvedByKey.set(key, { match: null, supplierCheck: 'pending' });
    }
  }

  // Persist newly-resolved entries + increment the month counter (one round trip).
  if (storeEntries.length > 0) {
    await cache.store(storeEntries);
  }

  // Fan the per-key resolutions back out to per-id.
  const out = new Map<string, SupplierResolution>();
  for (const s of capped) {
    const key = keyById.get(s.id)!;
    const r = resolvedByKey.get(key) ?? { match: null, supplierCheck: 'pending' as const };
    out.set(s.id, { match: r.match, supplierCheck: r.supplierCheck, normalizedKey: key });
  }
  return out;
}
