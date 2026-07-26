import { Hono } from 'hono';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { createDb, productOpportunities, type Database } from '@fulfillment-tracker/db';
import { computeOpportunityScore } from '@fulfillment-tracker/core';
import { createEbayMarketResearchClient, type EbayMarketResearchClient } from '@fulfillment-tracker/adapters/ebayMarketResearch';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

// Matches the original tool's own default deep-search threshold/iteration cap
// (see DECISIONS.md) — a keyword scoring below this is considered not worth
// listing as-is, prompting the refinement loop. Sub-keywords per round are
// capped well below what suggestRefinedKeywords can return, since each one
// costs a real Apify run — not free, unlike the original's own scraper.
const DEEP_SEARCH_THRESHOLD = 60;
const DEEP_SEARCH_MAX_ITERATIONS = 3;
const DEEP_SEARCH_KEYWORDS_PER_ROUND = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

interface ScanResult {
  id: string;
  keyword: string;
  totalSold: number;
  uniqueSellers: number;
  avgPriceCents: number;
  medianPriceCents: number;
  freeShippingPercent: number;
  opportunityScore: number;
  sampleListings: { title: string; url: string; priceCents: number }[];
}

async function runScan(db: Database, userId: string, client: EbayMarketResearchClient, keyword: string): Promise<ScanResult> {
  const sold = await client.searchSoldListings(keyword);
  const prices = sold.items.map((i) => i.soldPriceCents);
  const uniqueSellers = new Set(sold.items.map((i) => i.sellerUsername).filter(Boolean)).size;
  const avgPriceCents = prices.length ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length) : 0;
  const medianPriceCents = median(prices);
  const freeShippingPercent = sold.items.length
    ? Math.round((sold.items.filter((i) => i.freeShipping).length / sold.items.length) * 1000) / 10
    : 0;
  const opportunityScore = computeOpportunityScore({ avgPriceCents, uniqueSellers, totalSold: sold.items.length, freeShippingPercent });
  const sampleListings = sold.items.slice(0, 5).map((i) => ({ title: i.title, url: i.url, priceCents: i.soldPriceCents }));

  const id = newId();
  const scannedAt = now();
  await db.insert(productOpportunities).values({
    id,
    userId,
    keyword,
    totalListings: sold.items.length,
    uniqueSellers,
    avgPriceCents,
    medianPriceCents,
    freeShippingPercent,
    opportunityScore,
    sampleListingsJson: JSON.stringify(sampleListings),
    scannedAt,
    createdAt: scannedAt,
  });

  return { id, keyword, totalSold: sold.items.length, uniqueSellers, avgPriceCents, medianPriceCents, freeShippingPercent, opportunityScore, sampleListings };
}

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select()
    .from(productOpportunities)
    .where(eq(productOpportunities.userId, c.get('userId')))
    .orderBy(desc(productOpportunities.scannedAt));
  return c.json({
    opportunities: rows.map((r) => ({
      ...r,
      totalSold: r.totalListings,
      sampleListings: JSON.parse(r.sampleListingsJson),
      recommendedKeywords: r.aiRecommendedKeywordsJson ? JSON.parse(r.aiRecommendedKeywordsJson) : null,
    })),
  });
});

const searchSchema = z.object({ keyword: z.string().min(1), deepSearch: z.boolean().optional() });

/**
 * "What's worth listing" research, ported from the reference tool's own
 * methodology (see DECISIONS.md): scans confirmed-SOLD eBay data for a
 * keyword and scores it. With `deepSearch: true`, mirrors the original's
 * agentic loop — if the seed keyword's score is too low, asks Groq for more
 * specific sub-keywords, scans those too, and keeps the best-scoring one,
 * up to `DEEP_SEARCH_MAX_ITERATIONS` rounds. Every attempted keyword is
 * persisted as its own scan (not just the winner), so the history shows the
 * whole exploration. The winning keyword additionally gets a Groq-generated
 * advisory analysis (verdict/price range/margin/risk) attached — never
 * auto-acted on, purely for a human to read before deciding to source and
 * list the product.
 */
app.post('/search', async (c) => {
  const parsed = searchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }

  const db = createDb(c.env.DB);
  const userId = c.get('userId');
  const client = createEbayMarketResearchClient(c.env);

  let best = await runScan(db, userId, client, parsed.data.keyword);

  if (parsed.data.deepSearch) {
    const gemini = createGeminiExtractor(c.env);
    let iterations = 0;
    while (best.opportunityScore < DEEP_SEARCH_THRESHOLD && iterations < DEEP_SEARCH_MAX_ITERATIONS) {
      const suggested = await gemini.suggestRefinedKeywords({
        seedKeyword: best.keyword,
        currentScore: best.opportunityScore,
        sampleTitles: best.sampleListings.map((s) => s.title),
      });
      const round = suggested.slice(0, DEEP_SEARCH_KEYWORDS_PER_ROUND);
      for (const kw of round) {
        const result = await runScan(db, userId, client, kw);
        if (result.opportunityScore > best.opportunityScore) best = result;
      }
      iterations++;
    }

    const analysis = await gemini.analyzeOpportunity({
      keyword: best.keyword,
      avgPriceCents: best.avgPriceCents,
      totalSold: best.totalSold,
      uniqueSellers: best.uniqueSellers,
      freeShippingPercent: best.freeShippingPercent,
    });

    await db
      .update(productOpportunities)
      .set({
        aiVerdict: analysis.verdict,
        aiSellPriceMinCents: analysis.sellPriceMinCents,
        aiSellPriceMaxCents: analysis.sellPriceMaxCents,
        aiTargetSourcePriceCents: analysis.targetSourcePriceCents,
        aiMarginEstimateCents: analysis.marginEstimateCents,
        aiRisk: analysis.risk,
        aiRecommendedKeywordsJson: JSON.stringify(analysis.recommendedKeywords),
      })
      .where(eq(productOpportunities.id, best.id));

    return c.json({ ...best, ai: analysis });
  }

  return c.json(best);
});

export default app;
