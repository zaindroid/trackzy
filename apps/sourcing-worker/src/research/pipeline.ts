import { productCandidates, researchRuns, sellerSettings, type Database } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import { computeListingMargin, computeOpportunityScore } from '@fulfillment-tracker/core';
import { createEbayMarketResearchClient } from '@fulfillment-tracker/adapters/ebayMarketResearch';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { createSupplierClientForUser } from '../lib/supplierClient.js';

// Bounded per the plan: each niche is a real (paid) Apify call + supplier
// lookups, so v1 caps the fan-out to keep a research request inside a Worker's
// wall-clock budget. Cloudflare Queue/Workflow is the scale path for larger
// batches (phase 2).
const MAX_NICHES = 3;

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
export async function runResearch(env: Env, db: Database, userId: string, seed: string): Promise<string> {
  const runId = newId();
  await db.insert(researchRuns).values({ id: runId, userId, seed, status: 'running', createdAt: now() });

  try {
    const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
    const ebayFeePercent = settings?.ebayFeePercent ?? 13.25;

    const supplier = await createSupplierClientForUser(env, db, userId, 'cj');
    if (!supplier) {
      throw new Error('No supplier connected — connect CJ Dropshipping before researching.');
    }

    const gemini = createGeminiExtractor(env);
    const research = createEbayMarketResearchClient(env);

    // Seed + a couple of AI-expanded niches (the deep-search idea, one shot).
    const expansions = await gemini.suggestRefinedKeywords({ seedKeyword: seed, currentScore: 0, sampleTitles: [] });
    const keywords = [seed, ...expansions].slice(0, MAX_NICHES);

    for (const keyword of keywords) {
      try {
        const sold = await research.searchSoldListings(keyword);
        if (sold.items.length === 0) continue;

        const prices = sold.items.map((i) => i.soldPriceCents);
        const medianPriceCents = median(prices);
        const avgPriceCents = Math.round(prices.reduce((s, p) => s + p, 0) / prices.length);
        const uniqueSellers = new Set(sold.items.map((i) => i.sellerUsername).filter(Boolean)).size;
        const freeShippingPercent = Math.round((sold.items.filter((i) => i.freeShipping).length / sold.items.length) * 1000) / 10;

        const products = await supplier.searchProduct(keyword);
        const product = products[0];
        if (!product) continue;
        const offer = await supplier.getOffer(product.supplierProductId);

        const sellPriceCents = medianPriceCents;
        const { marginCents, marginPercent } = computeListingMargin({
          sellPriceCents,
          supplierCostCents: offer.costCents,
          ebayFeePercent,
          fulfillmentShippingCents: offer.shippingCents,
        });
        const opportunityScore = computeOpportunityScore({ avgPriceCents, uniqueSellers, totalSold: sold.items.length, freeShippingPercent });

        const content = await gemini.generateListingContent({
          keyword,
          supplierTitle: product.title,
          avgSoldPriceCents: avgPriceCents,
        });

        const imageUrls = product.imageUrl ? [product.imageUrl] : [];
        const candidateId = newId();
        await db.insert(productCandidates).values({
          id: candidateId,
          userId,
          runId,
          keyword,
          ebayAvgSoldPriceCents: avgPriceCents,
          ebayMedianPriceCents: medianPriceCents,
          ebaySoldCount: sold.items.length,
          supplierProvider: 'cj',
          supplierProductId: product.supplierProductId,
          supplierCostCents: offer.costCents,
          supplierProductUrl: product.productUrl ?? null,
          supplierImageUrlsJson: JSON.stringify(imageUrls),
          marginCents,
          marginPercent,
          opportunityScore,
          suggestedSellPriceCents: sellPriceCents,
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
      } catch (err) {
        console.error(`[research] niche "${keyword}" failed:`, err);
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
