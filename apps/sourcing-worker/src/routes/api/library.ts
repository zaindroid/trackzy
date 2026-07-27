import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { createDb, creditAccounts, productCandidates, sellerSettings, winners, winnerUnlocks } from '@sourcing/db';
import { computeListingMargin, computeSourcingScore } from '@fulfillment-tracker/core';
import { createScraperEbayClient } from '@fulfillment-tracker/adapters/scraperEbay';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';
import { CREDIT_COSTS, InsufficientCreditsError, spendCredits } from '../../lib/credits.js';
import { cachedDemand } from '../../lib/demandCache.js';
import { WINNER_FRESH_MS } from '../../lib/winners.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const MIN_SCORE_TO_SURFACE = 70;

/**
 * The winners library — a browsable catalog of vetted products (teasers). The
 * money signals (demand, margin %, score, price) are shown to create desire,
 * but the SUPPLIER link + list-ready content are withheld until unlocked.
 * Reserved winners (held for the Radar drip) are excluded. Marks which the
 * caller has already unlocked.
 */
app.get('/', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const rows = await db.select().from(winners).where(eq(winners.reserved, 0)).orderBy(desc(winners.score)).limit(100);
  const unlocked = new Set((await db.select().from(winnerUnlocks).where(eq(winnerUnlocks.userId, userId))).map((u) => u.winnerId));

  return c.json({
    winners: rows.map((w) => ({
      id: w.id,
      keyword: w.keyword,
      productTitle: w.productTitle,
      imageUrl: (JSON.parse(w.imageUrlsJson) as string[])[0] ?? null,
      ebaySoldCount: w.ebaySoldCount,
      ebayMedianPriceCents: w.ebayMedianPriceCents,
      marginCents: w.marginCents,
      marginPercent: w.marginPercent,
      score: w.score,
      unlocked: unlocked.has(w.id),
    })),
  });
});

/**
 * Unlock a winner: RE-CHECK its score today (freshness — a past winner can
 * decay), charge (free for active Pro subscribers, else 1 credit), copy it into
 * the user's candidates as a list-ready draft, and return the full detail. If it
 * has decayed below the quality gate, refresh the stored record and refuse
 * (refunding) rather than serve a stale product.
 */
app.post('/:id/unlock', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const [winner] = await db.select().from(winners).where(eq(winners.id, c.req.param('id')));
  if (!winner) return errorResponse(c, 'NOT_FOUND', 'Winner not found', 404);

  const [already] = await db
    .select()
    .from(winnerUnlocks)
    .where(and(eq(winnerUnlocks.userId, userId), eq(winnerUnlocks.winnerId, winner.id)));

  // Freshness re-check (skip if already scored today) — quality must hold.
  let { score, marginCents, marginPercent, ebaySoldCount, ebayMedianPriceCents } = winner;
  const { supplierCostCents } = winner;
  if (!already && now() - winner.lastScoredAt > WINNER_FRESH_MS) {
    try {
      const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
      const ebayFeePercent = settings?.ebayFeePercent ?? 13.25;
      const demand = await cachedDemand(db, createScraperEbayClient(c.env), winner.normalizedKey, winner.keyword);
      if (demand.items.length > 0) {
        ebaySoldCount = demand.totalSold;
        ebayMedianPriceCents = demand.medianPriceCents || ebayMedianPriceCents;
        const m = computeListingMargin({ sellPriceCents: ebayMedianPriceCents, supplierCostCents, ebayFeePercent, fulfillmentShippingCents: 0 });
        marginCents = m.marginCents;
        marginPercent = m.marginPercent;
        score = computeSourcingScore({ totalSold: ebaySoldCount, marginPercent, medianPriceCents: ebayMedianPriceCents });
      }
      await db.update(winners).set({ score, marginCents, marginPercent, ebaySoldCount, ebayMedianPriceCents, lastScoredAt: now(), updatedAt: now() }).where(eq(winners.id, winner.id));
    } catch (err) {
      console.error('[library] freshness re-check failed:', err);
    }
    if (score < MIN_SCORE_TO_SURFACE) {
      return errorResponse(c, 'WINNER_STALE', 'This product no longer meets the quality bar today — its demand or margin has dropped.', 409);
    }
  }

  // Charge unless already unlocked or an active Pro subscriber (free unlocks).
  if (!already) {
    const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));
    const proActive = acct?.plan === 'pro' && acct?.subscriptionStatus === 'active';
    if (!proActive) {
      try {
        await spendCredits(db, userId, CREDIT_COSTS.unlock, 'unlock', winner.id);
      } catch (err) {
        if (err instanceof InsufficientCreditsError) return errorResponse(c, 'INSUFFICIENT_CREDITS', 'Not enough credits to unlock — top up or go Pro.', 402);
        throw err;
      }
    }
    await db.insert(winnerUnlocks).values({ id: newId(), userId, winnerId: winner.id, createdAt: now() }).onConflictDoNothing();
    await db.update(winners).set({ timesUnlocked: winner.timesUnlocked + 1 }).where(eq(winners.id, winner.id));
  }

  // Copy into the user's candidates as a list-ready draft (idempotent-ish: a new
  // draft each unlock is fine; users can dismiss). Then return full detail.
  const imageUrls = JSON.parse(winner.imageUrlsJson) as string[];
  const candidateId = newId();
  try {
    await db.insert(productCandidates).values({
      id: candidateId,
      userId,
      runId: null,
      keyword: winner.keyword,
      ebayAvgSoldPriceCents: ebayMedianPriceCents,
      ebayMedianPriceCents,
      ebaySoldCount,
      supplierProvider: winner.supplierProvider,
      supplierProductId: winner.supplierProductId,
      supplierCostCents,
      supplierProductUrl: winner.supplierProductUrl,
      supplierImageUrlsJson: winner.imageUrlsJson,
      marginCents,
      marginPercent,
      opportunityScore: score,
      suggestedSellPriceCents: ebayMedianPriceCents,
      generatedTitle: winner.generatedTitle,
      generatedDescription: winner.generatedDescription,
      generatedAspectsJson: winner.generatedAspectsJson,
      categoryId: null,
      status: 'draft',
      ebayItemId: null,
      sku: null,
      createdAt: now(),
      updatedAt: now(),
    });
  } catch (err) {
    console.error('[library] candidate copy failed:', err);
  }

  return c.json({
    id: winner.id,
    candidateId,
    keyword: winner.keyword,
    productTitle: winner.productTitle,
    imageUrls,
    supplierProvider: winner.supplierProvider,
    supplierProductUrl: winner.supplierProductUrl,
    supplierCostCents,
    ebaySoldCount,
    ebayMedianPriceCents,
    marginCents,
    marginPercent,
    score,
    generatedTitle: winner.generatedTitle,
    generatedDescription: winner.generatedDescription,
  });
});

export default app;
