import { config, loadSeeds } from './config.js';
import { fetchEbayActive } from './ebay.js';
import { fetchEbaySold } from './soldData.js';
import { buildRadarItem } from './score.js';
import { postToRadar } from './ingest.js';
import { resolveSuppliers } from './supplier/lookup.js';
import { ApifyAliexpressProvider } from './supplier/apifyProvider.js';
import { WorkerCacheClient } from './supplier/cacheClient.js';
import type { EbayActiveSignal, EbaySoldSignal, RadarItem } from './types.js';

interface Scored {
  niche: string;
  active: EbayActiveSignal;
  sold: EbaySoldSignal | null;
}

async function main() {
  const seeds = loadSeeds();
  console.log(`[radar] crawling ${seeds.length} niches → ${config.ingestUrl}`);
  console.log(
    `[radar] sold data: ${config.apifyToken ? 'Apify enabled' : 'DISABLED (velocity=0)'} · ` +
      `supplier: ${config.apifyToken ? `Apify (budget ${config.apifyMonthlyResultBudget}/mo)` : 'DISABLED (cache-only, misses→pending)'}`,
  );

  // ── Phase 1: eBay demand + competition (the broad, free part) ──────────────
  const scored: Scored[] = [];
  for (const niche of seeds) {
    try {
      const active = await fetchEbayActive(niche);
      if (!active) {
        console.warn(`[radar] no eBay active listings for "${niche}" — skipping`);
        continue;
      }
      const sold = await fetchEbaySold(niche);
      scored.push({ niche, active, sold });
    } catch (err) {
      console.error(`[radar] "${niche}" failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Phase 2: rank, take survivors, cross-check suppliers (the NARROW, paid part) ──
  // Only survivors ever reach the supplier layer — the Apify credit bottleneck.
  scored.sort((a, b) => (b.sold?.salesPerDay ?? 0) - (a.sold?.salesPerDay ?? 0));
  const survivors = scored.slice(0, config.topNSurvivors);

  const cache = new WorkerCacheClient(config.ingestUrl, config.ingestToken);
  const provider = new ApifyAliexpressProvider(config.apifyToken ?? '', config.apifyAliexpressActorId, config.supplierTimeoutMs);
  // No Apify token → budget 0 so every cache miss defers to 'pending' and the
  // provider is never actually called (cached hits from prior runs still resolve).
  const monthlyBudget = config.apifyToken ? config.apifyMonthlyResultBudget : 0;

  const resolutions = await resolveSuppliers(
    survivors.map((s) => ({ id: s.niche, query: s.niche })),
    { provider, cache, config: { topN: config.topNSurvivors, ttlDays: config.cacheTtlDays, maxItems: config.maxItemsPerLookup, monthlyBudget } },
  );

  // ── Phase 3: assemble + post ───────────────────────────────────────────────
  const items: RadarItem[] = survivors.map((s) => {
    const r = resolutions.get(s.niche);
    const item = buildRadarItem(s.niche, s.active, s.sold, r?.match ?? null, r?.supplierCheck ?? 'none');
    console.log(
      `[radar] ${s.niche}: active=${item.ebayActiveCount} sold=${item.ebaySoldCount} ` +
        `supplier=${item.supplierCheck} score=${item.opportunityScore}`,
    );
    return item;
  });

  if (items.length === 0) {
    console.error('[radar] no items produced — not posting an empty snapshot');
    process.exit(1);
  }

  await postToRadar(items, 'replace');
  console.log(`[radar] done — ${items.length} products posted`);
}

main().catch((err) => {
  console.error('[radar] fatal:', err);
  process.exit(1);
});
