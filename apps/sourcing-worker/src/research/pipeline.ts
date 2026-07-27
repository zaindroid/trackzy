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

// How many items a single step advances per phase. Cloudflare's ctx.waitUntil()
// only guarantees ~30s of background execution after a response is sent — ON
// EVERY PLAN, not just free — so a single request that tries to run the WHOLE
// deep search (up to ~28 serial network calls) in one background job can get
// silently evicted past that ceiling, with no exception ever thrown (a run
// stuck at 'running' forever). Instead of one big background job, the pipeline
// advances a small bounded chunk of work per call, driven by the dashboard's
// EXISTING 2.5s poll loop (see GET /runs/:id) — each call is a short, normal
// request/response with no background continuation at all, so the ~30s ceiling
// never applies. A small budget keeps each individual poll snappy even if an
// upstream call is slow.
const STEP_ITEM_BUDGET = 2;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

type SourcedProduct = NonNullable<Awaited<ReturnType<typeof searchSupplier>>>[number];

interface Winner {
  keyword: string;
  key: string;
  avgPriceCents: number;
  medianPriceCents: number;
  totalSold: number;
  product: SourcedProduct;
  marginCents: number;
  marginPercent: number;
  score: number;
}

/** Resumable pipeline state, persisted as JSON on the run row between steps. */
export interface ResearchState {
  phase: 'init' | 'sourcing' | 'demand' | 'content';
  seed: string;
  provider: SourcingProvider;
  ebayFeePercent: number;
  keywords: { keyword: string; key: string }[];
  sourceableIdx: number;
  sourceable: { keyword: string; key: string; product: SourcedProduct }[];
  demandIdx: number;
  winners: Winner[];
  contentIdx: number;
}

export function initResearchState(seed: string, provider: SourcingProvider): ResearchState {
  return { phase: 'init', seed, provider, ebayFeePercent: 13.25, keywords: [], sourceableIdx: 0, sourceable: [], demandIdx: 0, winners: [], contentIdx: 0 };
}

/**
 * Advances a research run by ONE bounded step, mutating and persisting its
 * state. Called from GET /runs/:id on every poll while status is 'running' —
 * see the STEP_ITEM_BUDGET comment above for why the pipeline is structured
 * this way instead of one big background job. Best-effort per niche (one bad
 * niche is skipped, never fatal); on an unrecoverable error the run is marked
 * 'failed' and the error is rethrown so the caller can refund the credit.
 */
export async function stepResearch(env: Env, db: Database, userId: string, run: { id: string; stateJson: string | null }): Promise<void> {
  const state: ResearchState = run.stateJson ? (JSON.parse(run.stateJson) as ResearchState) : initResearchState('', 'aliexpress');

  try {
    switch (state.phase) {
      case 'init': {
        const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
        state.ebayFeePercent = settings?.ebayFeePercent ?? 13.25;

        // Connection check for CJ only. AliExpress is always available and its
        // probe would be a wasted (billable) Apify call — the seed is
        // researched in the sourcing phase anyway, so we don't pre-probe it.
        if (state.provider === 'cj' && (await searchSupplier(env, db, userId, 'cj', state.seed)) === null) {
          throw new Error('CJ Dropshipping is not connected — connect it, or use AliExpress (no connection needed).');
        }

        // Deep search: expand the one seed into many VARIED sub-niches, then
        // include the seed itself. Dedupe by normalized key so equivalent
        // phrasings aren't explored (or paid for) twice in one run.
        const gemini = createGeminiExtractor(env);
        const expansions = await gemini.expandNiches({ seed: state.seed, count: MAX_NICHES - 1 });
        const seen = new Set<string>();
        const keywords: { keyword: string; key: string }[] = [];
        for (const keyword of [state.seed, ...expansions]) {
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
        state.keywords = keywords;
        state.phase = 'sourcing';
        break;
      }

      // Phase 1a (FREE): supplier-source a batch of niches via the AliExpress DS
      // API (no per-call cost). Keeps only sourceable niches and carries the
      // supplier's own `orders` as a free demand hint for ranking which niches
      // deserve a paid demand check. This is the credit saver — we never spend
      // a ScraperAPI credit on a niche we can't even source.
      case 'sourcing': {
        const budget = Math.min(STEP_ITEM_BUDGET, state.keywords.length - state.sourceableIdx);
        for (let i = 0; i < budget; i++) {
          const { keyword, key } = state.keywords[state.sourceableIdx]!;
          state.sourceableIdx++;
          try {
            const products = await searchSupplier(env, db, userId, state.provider, keyword);
            const product = products?.[0];
            if (!product) continue;
            // VeRO gate #2 (before scoring): a clean keyword can still match a
            // BRANDED supplier product — screen the actual matched title and
            // drop it if risky.
            const vero = screenVero(product.title);
            if (vero.blocked) {
              console.log(`[research] VeRO-skip product "${product.title}" (matched ${vero.reason}: ${vero.matchedTerm})`);
              continue;
            }
            state.sourceable.push({ keyword, key, product });
          } catch (err) {
            console.error(`[research] supplier search "${keyword}" failed:`, err);
          }
        }
        if (state.sourceableIdx >= state.keywords.length) {
          // Rank by the free supplier-orders signal (best-selling on AliExpress
          // first), then only demand-check the top few — capping paid calls.
          state.sourceable.sort((a, b) => (b.product.orders ?? 0) - (a.product.orders ?? 0));
          state.phase = 'demand';
        }
        break;
      }

      // Phase 1b (PAID, capped + cached): confirm real eBay demand on the top
      // sourceable niches → margin → sourcing score → ≥70 gate.
      case 'demand': {
        const pool = state.sourceable.slice(0, MAX_DEMAND_CHECKS);
        const budget = Math.min(STEP_ITEM_BUDGET, pool.length - state.demandIdx);
        const research = createScraperEbayClient(env);
        for (let i = 0; i < budget; i++) {
          const { keyword, key, product } = pool[state.demandIdx]!;
          state.demandIdx++;
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
              ebayFeePercent: state.ebayFeePercent,
              fulfillmentShippingCents: 0,
            });
            if (marginCents <= 0) continue;

            const score = computeSourcingScore({ totalSold: demand.totalSold, marginPercent, medianPriceCents, activeListingCount: demand.activeListingCount });
            // Quality gate — only genuine high-potential products get through.
            // Competition-aware: a saturated niche (many active listings vs
            // sales) scores lower via sell-through rate and is more likely
            // filtered here.
            if (score < MIN_SCORE_TO_SURFACE) continue;

            state.winners.push({ keyword, key, avgPriceCents, medianPriceCents, totalSold: demand.totalSold, product, marginCents, marginPercent, score });
          } catch (err) {
            console.error(`[research] niche "${keyword}" failed:`, err);
          }
        }
        if (state.demandIdx >= pool.length) {
          state.winners.sort((a, b) => b.score - a.score);
          state.phase = 'content';
        }
        break;
      }

      // Phase 2: generate listing content for the top winners and persist.
      case 'content': {
        const pool = state.winners.slice(0, MAX_CANDIDATES);
        const budget = Math.min(STEP_ITEM_BUDGET, pool.length - state.contentIdx);
        const gemini = createGeminiExtractor(env);
        for (let i = 0; i < budget; i++) {
          const w = pool[state.contentIdx]!;
          state.contentIdx++;
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
              runId: run.id,
              keyword: w.keyword,
              ebayAvgSoldPriceCents: w.avgPriceCents,
              ebayMedianPriceCents: w.medianPriceCents,
              ebaySoldCount: w.totalSold,
              supplierProvider: state.provider,
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
              supplierProvider: state.provider,
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
        if (state.contentIdx >= pool.length) {
          await db.update(researchRuns).set({ status: 'done', error: null, stateJson: null }).where(eq(researchRuns.id, run.id));
          return;
        }
        break;
      }
    }

    await db.update(researchRuns).set({ stateJson: JSON.stringify(state) }).where(eq(researchRuns.id, run.id));
  } catch (err) {
    await db
      .update(researchRuns)
      .set({ status: 'failed', error: err instanceof Error ? err.message : String(err), stateJson: null })
      .where(eq(researchRuns.id, run.id));
    throw err;
  }
}
