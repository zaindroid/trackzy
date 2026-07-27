import { winners, type Database } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import { newId, now } from './id.js';

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
    await db.insert(winners).values({ id: newId(), normalizedKey: w.normalizedKey, ...row, reserved: 0, timesUnlocked: 0, createdAt: ts }).onConflictDoNothing();
    return;
  }
  // Keep whichever scores higher; always refresh lastScoredAt so freshness is honest.
  if (w.score >= existing.score) {
    await db.update(winners).set(row).where(eq(winners.id, existing.id));
  } else {
    await db.update(winners).set({ lastScoredAt: ts, updatedAt: ts }).where(eq(winners.id, existing.id));
  }
}
