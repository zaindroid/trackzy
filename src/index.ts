import { config, loadSeeds } from './config.js';
import { generateNiches } from './seeds/llm.js';
import { fetchEbayActive } from './ebay.js';
import { fetchEbaySold } from './soldData.js';
import { buildRadarItem } from './score.js';
import { postToRadar } from './ingest.js';
import { resolveSuppliers } from './supplier/lookup.js';
import { ApifyAliexpressProvider } from './supplier/apifyProvider.js';
import { AffiliateSupplierProvider } from './supplier/affiliateProvider.js';
import { WorkerCacheClient } from './supplier/cacheClient.js';
import type { EbayActiveSignal, EbaySoldSignal, RadarItem } from './types.js';

interface Scored {
  niche: string;
  active: EbayActiveSignal;
  sold: EbaySoldSignal | null;
}

async function main() {
  // The LLM picks specific, high-opportunity niches each run; seeds.json is only
  // a fallback when no Groq key is configured.
  let seeds: string[] = [];
  if (config.groqApiKey) {
    try {
      seeds = await generateNiches({ apiKey: config.groqApiKey, model: config.groqModel, count: config.maxNiches, themes: config.seedThemes });
      console.log(`[radar] LLM proposed ${seeds.length} niches: ${seeds.join(' | ')}`);
    } catch (err) {
      console.warn('[radar] LLM niche generation failed, falling back to seeds.json:', err instanceof Error ? err.message : err);
    }
  }
  if (seeds.length === 0) seeds = loadSeeds().slice(0, config.maxNiches);

  console.log(`[radar] crawling ${seeds.length} niches → ${config.ingestUrl}`);
  const usingAffiliateForLog = !!(config.aliexpressAppKey && config.aliexpressAppSecret);
  console.log(
    `[radar] niches: ${config.groqApiKey ? 'LLM (Groq)' : 'seeds.json'} · ` +
      `demand: ${config.useApifySold && config.apifyToken ? 'Apify sold-velocity' : 'eBay Browse (free: competition + price)'} · ` +
      `supplier: ${usingAffiliateForLog ? 'AliExpress Affiliate API (free)' : config.apifyToken ? `Apify (budget ${config.apifyMonthlyResultBudget}/mo)` : 'cache-only, misses→pending'}`,
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
      // Demand: free eBay Browse (competition + price) by default; real
      // Apify sold-velocity only when explicitly enabled (USE_APIFY_SOLD).
      const sold = config.useApifySold && config.apifyToken ? await fetchEbaySold(niche) : null;
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
  // Prefer OUR OWN AliExpress Affiliate API (signed, free, no Apify) when keys
  // are configured; otherwise fall back to the Apify actor. Affiliate lookups
  // report resultsConsumed=0, so the Apify monthly ceiling doesn't apply.
  const usingAffiliate = !!(config.aliexpressAppKey && config.aliexpressAppSecret);
  const provider = usingAffiliate
    ? new AffiliateSupplierProvider(config.aliexpressAppKey!, config.aliexpressAppSecret!)
    : new ApifyAliexpressProvider(config.apifyToken ?? '', config.apifyAliexpressActorId, config.supplierTimeoutMs);
  // Affiliate → effectively unlimited (no per-result cost). Apify → the monthly
  // result ceiling, or 0 (all misses pending) when there's no Apify token either.
  const monthlyBudget = usingAffiliate ? Number.MAX_SAFE_INTEGER : config.apifyToken ? config.apifyMonthlyResultBudget : 0;

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
