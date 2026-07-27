import { winners, winnerScoreHistory, type Database } from '@sourcing/db';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { newId, now } from './id.js';

function startOfUtcDay(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

/** Records a daily score snapshot for a winner (at most one per UTC day), for
 * the leaderboard's moving charts. */
export async function snapshotWinnerScore(db: Database, winnerId: string, score: number, ebaySoldCount: number, marginCents: number): Promise<void> {
  const [todays] = await db
    .select()
    .from(winnerScoreHistory)
    .where(and(eq(winnerScoreHistory.winnerId, winnerId), gte(winnerScoreHistory.capturedAt, startOfUtcDay(now()))))
    .limit(1);
  const ts = now();
  if (todays) {
    await db.update(winnerScoreHistory).set({ score, ebaySoldCount, marginCents, capturedAt: ts }).where(eq(winnerScoreHistory.id, todays.id));
  } else {
    await db.insert(winnerScoreHistory).values({ id: newId(), winnerId, score, ebaySoldCount, marginCents, capturedAt: ts });
  }
}

/** Recent daily scores (chronological) for a set of winners — for sparklines. */
export async function recentScores(db: Database, winnerIds: string[], limitPerWinner = 8): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (winnerIds.length === 0) return out;
  const rows = await db
    .select()
    .from(winnerScoreHistory)
    .where(inArray(winnerScoreHistory.winnerId, winnerIds))
    .orderBy(desc(winnerScoreHistory.capturedAt));
  // Group newest-first, then trim + reverse to chronological.
  for (const r of rows) {
    const arr = out.get(r.winnerId) ?? [];
    if (arr.length < limitPerWinner) arr.push(r.score);
    out.set(r.winnerId, arr);
  }
  for (const [k, v] of out) out.set(k, v.reverse());
  return out;
}

// A winner is considered stale (needs a same-day re-score before serving) once
// its last scoring is older than this. Keeps the quality bar honest.
export const WINNER_FRESH_MS = 24 * 60 * 60 * 1000;

export interface WinnerInput {
  normalizedKey: string;
  keyword: string;
  productTitle: string;
  imageUrls: string[];
  supplierProvider: string;
  supplierProductId: string;
  supplierCostCents: number;
  supplierProductUrl: string | null;
  ebaySoldCount: number;
  ebayMedianPriceCents: number;
  marginCents: number;
  marginPercent: number;
  score: number;
  generatedTitle: string;
  generatedDescription: string;
  generatedAspectsJson: string;
}

/**
 * Adds/updates a winner in the global library, deduped by niche. On conflict we
 * keep the BEST-scoring find and refresh its data + lastScoredAt — so the
 * library always holds the strongest known product per niche, freshly scored.
 */
export async function upsertWinner(db: Database, w: WinnerInput): Promise<void> {
  const ts = now();
  const [existing] = await db.select().from(winners).where(eq(winners.normalizedKey, w.normalizedKey));
  const row = {
    keyword: w.keyword,
    productTitle: w.productTitle,
    imageUrlsJson: JSON.stringify(w.imageUrls),
    supplierProvider: w.supplierProvider,
    supplierProductId: w.supplierProductId,
    supplierCostCents: w.supplierCostCents,
    supplierProductUrl: w.supplierProductUrl,
    ebaySoldCount: w.ebaySoldCount,
    ebayMedianPriceCents: w.ebayMedianPriceCents,
    marginCents: w.marginCents,
    marginPercent: w.marginPercent,
    score: w.score,
    generatedTitle: w.generatedTitle,
    generatedDescription: w.generatedDescription,
    generatedAspectsJson: w.generatedAspectsJson,
    lastScoredAt: ts,
    updatedAt: ts,
  };

  if (!existing) {
    const id = newId();
    await db.insert(winners).values({ id, normalizedKey: w.normalizedKey, ...row, reserved: 0, timesUnlocked: 0, createdAt: ts }).onConflictDoNothing();
    await snapshotWinnerScore(db, id, w.score, w.ebaySoldCount, w.marginCents).catch(() => {});
    return;
  }
  // Keep whichever scores higher; always refresh lastScoredAt so freshness is honest.
  const effectiveScore = w.score >= existing.score ? w.score : existing.score;
  if (w.score >= existing.score) {
    await db.update(winners).set(row).where(eq(winners.id, existing.id));
  } else {
    await db.update(winners).set({ lastScoredAt: ts, updatedAt: ts }).where(eq(winners.id, existing.id));
  }
  await snapshotWinnerScore(db, existing.id, effectiveScore, w.ebaySoldCount, w.marginCents).catch(() => {});
}
