import { productCandidates, researchRuns, sellerSettings, type Database } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import { computeListingMargin, computeSourcingScore, screenVero } from '@fulfillment-tracker/core';
import { createScraperEbayClient } from '@fulfillment-tracker/adapters/scraperEbay';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { searchSupplier, type SourcingProvider } from '../lib/sourcingSupplier.js';
import { cachedDemand, normalizeNiche } from '../lib/demandCache.js';
import { upsertWinner } from '../lib/winners.js';

// Deep search: the LLM expands one seed into many VARIED sub-niches and we
// explore each (ScraperAPI demand + free AliExpress DS supplier), then keep only
// the genuine winners. Wider fan-out = more range of high-potential products
// from a single seed. Each niche is one ScraperAPI call + free DS calls, so this
// is bounded to stay inside a Worker request and mindful of ScraperAPI credits.
const MAX_NICHES = 12;

// Demand floor — a niche must show at least this many proven eBay sales (total
// items_sold) before we bother sourcing it. Cheap pre-filter for dead niches.
const MIN_SOLD_FOR_SOURCING = 5;

// Quality gate — only surface genuinely high-potential candidates. A product
// must clear this sourcing score (proven demand + margin + price band) to be
// shown, so the feed isn't polluted with mediocre ~45-score items.
const MIN_SCORE_TO_SURFACE = 70;

// Cap how many winners we persist per run (ranked best-first).
const MAX_CANDIDATES = 10;

// Credit saver: we explore all MAX_NICHES for a (free) supplier, but only spend
// a (paid) ScraperAPI demand call on the most promising this many — ranked by
// the free supplier signal. Keeps range while roughly halving credit spend.
const MAX_DEMAND_CHECKS = 6;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Runs one research session end-to-end and persists ranked, list-ready
 * candidates. Reuses the exact same building blocks trackzy's Opportunities
 * feature does (Apify sold-data, `computeOpportunityScore`, Groq), plus the
 * supplier cross-reference + margin math + listing-content generation that
 * make a candidate one-click-listable. Best-effort per niche: one bad niche
 * (empty sold data, no supplier match, a flaky API) is skipped, never fatal
 * to the whole run.
 */
export async function runResearch(env: Env, db: Database, userId: string, seed: string, provider: SourcingProvider, existingRunId?: string): Promise<string> {
  // The run row may be pre-created by the caller (async path, so the request can
  // return the id immediately); otherwise create it here (sync/tests).
  const runId = existingRunId ?? newId();
  if (!existingRunId) {
    await db.insert(researchRuns).values({ id: runId, userId, seed, status: 'running', createdAt: now() });
  }

  try {
    const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
    const ebayFeePercent = settings?.ebayFeePercent ?? 13.25;

    // Connection check for CJ only. AliExpress is always available and its probe
    // would be a wasted (billable) Apify call — the seed is researched in the
    // loop below anyway, so we don't pre-probe it.
    if (provider === 'cj' && (await searchSupplier(env, db, userId, 'cj', seed)) === null) {
      throw new Error('CJ Dropshipping is not connected — connect it, or use AliExpress (no connection needed).');
    }

    const gemini = createGeminiExtractor(env);
    const research = createScraperEbayClient(env);

    // Deep search: expand the one seed into many VARIED sub-niches, then include
    // the seed itself. Dedupe by normalized key so equivalent phrasings aren't
    // explored (or paid for) twice in one run.
    const expansions = await gemini.expandNiches({ seed, count: MAX_NICHES - 1 });
    const seen = new Set<string>();
    const keywords: { keyword: string; key: string }[] = [];
    for (const keyword of [seed, ...expansions]) {
      const key = normalizeNiche(keyword);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      // VeRO gate #1 (before any paid work): drop brand/trademark/counterfeit-risk
      // niches up front, so we never spend a demand credit — or surface a listing —
      // on something that would get the seller's eBay account suspended.
      const vero = screenVero(keyword);
      if (vero.blocked) {
        console.log(`[research] VeRO-skip niche "${keyword}" (matched ${vero.reason}: ${vero.matchedTerm})`);
        continue;
      }
      keywords.push({ keyword, key });
      if (keywords.length >= MAX_NICHES) break;
    }

    type SourcedProduct = NonNullable<Awaited<ReturnType<typeof searchSupplier>>>[number];

    // Phase 1a (FREE): supplier-source every niche via the AliExpress DS API (no
    // per-call cost). Keeps only sourceable niches and carries the supplier's own
    // `orders` as a free demand hint for ranking which niches deserve a paid
    // demand check. This is the credit saver — we never spend a ScraperAPI credit
    // on a niche we can't even source.
    const sourceable: { keyword: string; key: string; product: SourcedProduct }[] = [];
    for (const { keyword, key } of keywords) {
      try {
        const products = await searchSupplier(env, db, userId, provider, keyword);
        const product = products?.[0];
        if (!product) continue;
        // VeRO gate #2 (before scoring): a clean keyword can still match a BRANDED
        // supplier product — screen the actual matched title and drop it if risky.
        const vero = screenVero(product.title);
        if (vero.blocked) {
          console.log(`[research] VeRO-skip product "${product.title}" (matched ${vero.reason}: ${vero.matchedTerm})`);
          continue;
        }
        sourceable.push({ keyword, key, product });
      } catch (err) {
        console.error(`[research] supplier search "${keyword}" failed:`, err);
      }
    }
    // Rank by the free supplier-orders signal (best-selling on AliExpress first),
    // then only demand-check the top few — capping paid ScraperAPI calls.
    sourceable.sort((a, b) => (b.product.orders ?? 0) - (a.product.orders ?? 0));

    interface Winner {
      keyword: string;
      avgPriceCents: number;
      medianPriceCents: number;
      key: string;
      totalSold: number;
      product: SourcedProduct;
      marginCents: number;
      marginPercent: number;
      score: number;
    }
    const winners: Winner[] = [];

    // Phase 1b (PAID, capped + cached): confirm real eBay demand on the top
    // sourceable niches → margin → sourcing score → ≥70 gate.
    for (const { keyword, key, product } of sourceable.slice(0, MAX_DEMAND_CHECKS)) {
      try {
        const demand = await cachedDemand(db, research, key, keyword);
        if (demand.totalSold < MIN_SOLD_FOR_SOURCING || demand.items.length === 0) continue;

        const prices = demand.items.map((i) => i.priceCents).filter((c) => c > 0);
        if (prices.length === 0) continue;
        const medianPriceCents = demand.medianPriceCents || median(prices);
        const avgPriceCents = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);

        const { marginCents, marginPercent } = computeListingMargin({
          sellPriceCents: medianPriceCents,
          supplierCostCents: product.costCents,
          ebayFeePercent,
          fulfillmentShippingCents: 0,
        });
        if (marginCents <= 0) continue;

        const score = computeSourcingScore({ totalSold: demand.totalSold, marginPercent, medianPriceCents, activeListingCount: demand.activeListingCount });
        // Quality gate — only genuine high-potential products get through. Now
        // competition-aware: a saturated niche (many active listings vs sales)
        // scores lower via sell-through rate and is more likely filtered here.
        if (score < MIN_SCORE_TO_SURFACE) continue;

        winners.push({ keyword, key, avgPriceCents, medianPriceCents, totalSold: demand.totalSold, product, marginCents, marginPercent, score });
      } catch (err) {
        console.error(`[research] niche "${keyword}" failed:`, err);
      }
    }

    // Phase 2: rank winners best-first, take the top N, generate listing content
    // only for those, and persist.
    winners.sort((a, b) => b.score - a.score);
    for (const w of winners.slice(0, MAX_CANDIDATES)) {
      try {
        const content = await gemini.generateListingContent({
          keyword: w.keyword,
          supplierTitle: w.product.title,
          avgSoldPriceCents: w.avgPriceCents,
        });
        const imageUrls = w.product.imageUrls.length > 0 ? w.product.imageUrls : w.product.imageUrl ? [w.product.imageUrl] : [];
        await db.insert(productCandidates).values({
          id: newId(),
          userId,
          runId,
          keyword: w.keyword,
          ebayAvgSoldPriceCents: w.avgPriceCents,
          ebayMedianPriceCents: w.medianPriceCents,
          ebaySoldCount: w.totalSold,
          supplierProvider: provider,
          supplierProductId: w.product.productId,
          supplierCostCents: w.product.costCents,
          supplierProductUrl: w.product.productUrl ?? null,
          supplierImageUrlsJson: JSON.stringify(imageUrls),
          marginCents: w.marginCents,
          marginPercent: w.marginPercent,
          opportunityScore: w.score,
          suggestedSellPriceCents: w.medianPriceCents,
          generatedTitle: content.title,
          generatedDescription: content.descriptionHtml,
          generatedAspectsJson: JSON.stringify(content.aspects),
          categoryId: null,
          status: 'draft',
          ebayItemId: null,
          sku: null,
          createdAt: now(),
          updatedAt: now(),
        });

        // Feed the global winners library (deduped per niche, best score kept).
        await upsertWinner(db, {
          normalizedKey: w.key,
          keyword: w.keyword,
          productTitle: w.product.title,
          imageUrls,
          supplierProvider: provider,
          supplierProductId: w.product.productId,
          supplierCostCents: w.product.costCents,
          supplierProductUrl: w.product.productUrl ?? null,
          ebaySoldCount: w.totalSold,
          ebayMedianPriceCents: w.medianPriceCents,
          marginCents: w.marginCents,
          marginPercent: w.marginPercent,
          score: w.score,
          generatedTitle: content.title,
          generatedDescription: content.descriptionHtml,
          generatedAspectsJson: JSON.stringify(content.aspects),
        }).catch((err) => console.error(`[research] upsertWinner "${w.keyword}" failed:`, err));
      } catch (err) {
        console.error(`[research] persisting winner "${w.keyword}" failed:`, err);
      }
    }

    await db.update(researchRuns).set({ status: 'done' }).where(eq(researchRuns.id, runId));
  } catch (err) {
    await db
      .update(researchRuns)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err) })
      .where(eq(researchRuns.id, runId));
    throw err;
  }

  return runId;
}
