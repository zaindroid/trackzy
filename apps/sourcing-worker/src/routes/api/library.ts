import { Hono } from 'hono';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { createDb, creditAccounts, productCandidates, sellerSettings, winners, winnerUnlocks } from '@sourcing/db';
import { computeListingMargin, computeSourcingScore } from '@fulfillment-tracker/core';
import { createScraperEbayClient } from '@fulfillment-tracker/adapters/scraperEbay';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';
import { CREDIT_COSTS, InsufficientCreditsError, spendCredits } from '../../lib/credits.js';
import { cachedDemand } from '../../lib/demandCache.js';
import { WINNER_FRESH_MS, recentScores, snapshotWinnerScore } from '../../lib/winners.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const MIN_SCORE_TO_SURFACE = 70;
// Pro subscribers unlock this many library winners free PER DAY; beyond that they
// spend credits like everyone else. Keeps the hidden library scarce/valuable
// while still feeling generous.
const DAILY_PRO_FREE_UNLOCKS = 25;

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

// Golden Products are gated to Pro subscribers, and only the top slice is shown.
const GOLDEN_TOP_N = 20;

function isProActive(acct: { plan?: string | null; subscriptionStatus?: string | null } | undefined): boolean {
  return acct?.plan === 'pro' && acct?.subscriptionStatus === 'active';
}

// Teaser redaction — reveal enough to create desire (a hint + the numbers) but
// NOT the full title, so a user can't just copy it into AliExpress/eBay and
// bypass unlocking. Shows the first ~half of the words, masks the rest.
function redactTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return '••••••';
  const keep = Math.max(1, Math.floor(words.length / 2));
  return `${words.slice(0, keep).join(' ')} ••••••`;
}

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
  const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));

  // Golden Products is a Pro-only vault. Non-Pro get an upsell, not the goods.
  if (!isProActive(acct)) {
    return c.json({ access: false, winners: [] });
  }

  const rows = await db.select().from(winners).where(eq(winners.reserved, 0)).orderBy(desc(winners.score)).limit(GOLDEN_TOP_N);
  const unlocked = new Set((await db.select().from(winnerUnlocks).where(eq(winnerUnlocks.userId, userId))).map((u) => u.winnerId));

  return c.json({
    access: true,
    winners: rows.map((w) => {
      const isUnlocked = unlocked.has(w.id);
      const image = (JSON.parse(w.imageUrlsJson) as string[])[0] ?? null;
      return {
        id: w.id,
        // Full title/clear image only once unlocked; otherwise a redacted teaser
        // served via the proxy (raw supplier URL never exposed) so the product
        // can't be self-sourced.
        productTitle: isUnlocked ? w.productTitle : redactTitle(w.productTitle),
        imageUrl: isUnlocked ? image : `/winner-image/${w.id}`,
        blurred: !isUnlocked,
        ebaySoldCount: w.ebaySoldCount,
        ebayMedianPriceCents: w.ebayMedianPriceCents,
        marginCents: w.marginCents,
        marginPercent: w.marginPercent,
        score: w.score,
        unlocked: isUnlocked,
      };
    }),
  });
});

/**
 * Leaderboard data for the engagement view — top winners with every ranking
 * metric so the client can sort/animate across Opportunity / Demand / Margin /
 * Trending. `trending` (unlock popularity) and freshness re-scoring make it move
 * over time; the client polls to keep it feeling live. Teaser fields only (no
 * supplier link) — unlocking still happens on the Library tab.
 */
app.get('/leaderboard', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const rows = await db.select().from(winners).where(eq(winners.reserved, 0)).orderBy(desc(winners.score)).limit(50);
  const weekAgo = now() - 7 * 86_400_000;
  const sparks = await recentScores(db, rows.map((w) => w.id));
  return c.json({
    winners: rows.map((w) => {
      const spark = sparks.get(w.id) ?? [w.score];
      const scoreDelta = spark.length > 1 ? Math.round((w.score - spark[0]!) * 10) / 10 : 0; // vs oldest point in window
      return {
        id: w.id,
        // Redacted — the leaderboard is the public hook: show the numbers and a
        // teaser, not the identifiable product (that's unlocked in Golden Products).
        productTitle: redactTitle(w.productTitle),
        imageUrl: `/winner-image/${w.id}`, // proxied teaser — raw supplier URL never exposed
        score: w.score,
        scoreDelta,
        spark, // chronological recent daily scores for a sparkline
        ebaySoldCount: w.ebaySoldCount,
        marginCents: w.marginCents,
        marginPercent: w.marginPercent,
        timesUnlocked: w.timesUnlocked,
        isNew: w.createdAt >= weekAgo,
      };
    }),
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
      await snapshotWinnerScore(db, winner.id, score, ebaySoldCount, marginCents).catch(() => {});
    } catch (err) {
      console.error('[library] freshness re-check failed:', err);
    }
    if (score < MIN_SCORE_TO_SURFACE) {
      return errorResponse(c, 'WINNER_STALE', 'This product no longer meets the quality bar today — its demand or margin has dropped.', 409);
    }
  }

  // Charging: Pro subscribers get DAILY_PRO_FREE_UNLOCKS free per day; beyond
  // that (or without Pro) each unlock costs a credit.
  if (!already) {
    const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));
    const proActive = acct?.plan === 'pro' && acct?.subscriptionStatus === 'active';
    let freeUnlock = false;
    if (proActive) {
      const [{ count } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(winnerUnlocks)
        .where(and(eq(winnerUnlocks.userId, userId), gte(winnerUnlocks.createdAt, startOfUtcDay(now()))));
      freeUnlock = Number(count) < DAILY_PRO_FREE_UNLOCKS;
    }
    if (!freeUnlock) {
      try {
        await spendCredits(db, userId, CREDIT_COSTS.unlock, 'unlock', winner.id);
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          const msg = proActive
            ? `You've used your ${DAILY_PRO_FREE_UNLOCKS} free Pro unlocks today — top up credits for more.`
            : 'Not enough credits to unlock — top up or go Pro.';
          return errorResponse(c, 'INSUFFICIENT_CREDITS', msg, 402);
        }
        throw err;
      }
    }
    await db.insert(winnerUnlocks).values({ id: newId(), userId, winnerId: winner.id, createdAt: now() }).onConflictDoNothing();
    await db.update(winners).set({ timesUnlocked: winner.timesUnlocked + 1 }).where(eq(winners.id, winner.id));
  }

  // Copy into the user's candidates as a list-ready draft — only on the FIRST
  // unlock, so repeat views don't pile up duplicate drafts. Then return detail.
  const imageUrls = JSON.parse(winner.imageUrlsJson) as string[];
  const candidateId = newId();
  if (!already) {
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
