import { listingMonitors, listingPriceHistory, productCandidates, sellerSettings, type Database } from '@sourcing/db';
import { and, eq, lt, or, isNull } from 'drizzle-orm';
import { decideReprice, type RepriceDecision } from '@fulfillment-tracker/core';
import { createAliexpressDsClient } from '@fulfillment-tracker/adapters/aliexpressDs';
import { createEbayListingClient } from '@fulfillment-tracker/adapters/ebayListing';
import type { Env } from '../env.js';
import { newId, now } from './id.js';
import { getFreshEbayToken } from './ebayConnection.js';

type Monitor = typeof listingMonitors.$inferSelect;
type Candidate = typeof productCandidates.$inferSelect;

const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // re-check each listing every ~6h

function healthFrom(decision: RepriceDecision, marginPercent: number, minMargin: number): Monitor['health'] {
  if (decision.action === 'pause_oos' || decision.action === 'pause_unprofitable') return 'paused';
  if (marginPercent < minMargin) return 'critical';
  if (marginPercent < minMargin + 5) return 'warning';
  return 'healthy';
}

/**
 * Monitors ONE listed product: re-fetch supplier cost + stock (free DS call, no
 * ScraperAPI credit), decide the smart action, apply it to the live eBay listing,
 * and log the price-history point. Innovative beyond AutoDS: on a stock-out it
 * first tries a SUPPLIER AUTO-SWITCH (a cheaper/available listing of the same
 * product) before pausing. Fully isolated — one listing's failure never affects
 * the batch. Returns the action taken (for logging).
 */
export async function monitorOne(env: Env, db: Database, monitor: Monitor, candidate: Candidate): Promise<string> {
  const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, monitor.userId));
  const ebayFeePercent = settings?.ebayFeePercent ?? 13.25;
  const ds = createAliexpressDsClient(env);

  let productId = candidate.supplierProductId;
  let status = await ds.getProductStatus(productId).catch(() => null);
  let switched = false;

  // Supplier auto-switch: if OOS (or we couldn't read it), look for a cheaper/
  // available alternative of the same niche and adopt it before pausing.
  if (!status || !status.inStock) {
    const alts = await ds.searchProducts(candidate.keyword, 8).catch(() => []);
    const alt = alts.find((p) => p.productId !== productId && p.costCents > 0);
    if (alt) {
      const altStatus = await ds.getProductStatus(alt.productId).catch(() => null);
      if (altStatus?.inStock) {
        productId = alt.productId;
        status = altStatus;
        switched = true;
        await db
          .update(productCandidates)
          .set({ supplierProductId: alt.productId, supplierCostCents: alt.costCents, supplierProductUrl: alt.productUrl ?? candidate.supplierProductUrl, updatedAt: now() })
          .where(eq(productCandidates.id, candidate.id));
      }
    }
  }

  const inStock = !!status?.inStock;
  const supplierCostCents = status?.costCents ?? candidate.supplierCostCents;
  const currentSellPriceCents = candidate.suggestedSellPriceCents;

  const decision = decideReprice({
    supplierCostCents,
    inStock,
    currentSellPriceCents,
    competitorMedianCents: candidate.ebayMedianPriceCents, // stored market median (no extra credit)
    ebayFeePercent,
    fulfillmentShippingCents: 0,
    minMarginPercent: monitor.minMarginPercent,
    priceCeilingCents: monitor.priceCeilingCents,
  });

  // Apply to the live eBay listing (only if connected + we have an item id).
  const accessToken = candidate.ebayItemId ? await getFreshEbayToken(env, db, monitor.userId).catch(() => null) : null;
  const listing = createEbayListingClient(env);
  let appliedSellPrice = currentSellPriceCents;
  try {
    if (accessToken && candidate.ebayItemId) {
      if (decision.action === 'reprice') {
        await listing.reviseListingPrice(accessToken, candidate.ebayItemId, decision.newSellPriceCents);
        appliedSellPrice = decision.newSellPriceCents;
        await db.update(productCandidates).set({ suggestedSellPriceCents: decision.newSellPriceCents, updatedAt: now() }).where(eq(productCandidates.id, candidate.id));
      } else if (decision.action === 'pause_oos' || decision.action === 'pause_unprofitable') {
        await listing.setListingQuantity(accessToken, candidate.ebayItemId, 0);
      }
    } else if (decision.action === 'reprice') {
      // No eBay revise possible — still record the recommended price.
      appliedSellPrice = decision.newSellPriceCents;
      await db.update(productCandidates).set({ suggestedSellPriceCents: decision.newSellPriceCents, updatedAt: now() }).where(eq(productCandidates.id, candidate.id));
    }
  } catch (err) {
    console.error(`[monitor] apply failed for ${candidate.id}:`, err);
  }

  const stockStatus: Monitor['stockStatus'] = inStock ? 'in' : 'out';
  const lastAction = switched ? `switched_supplier→${decision.action}` : decision.action;
  const ts = now();
  await db
    .update(listingMonitors)
    .set({
      stockStatus,
      currentSupplierCostCents: supplierCostCents,
      currentSellPriceCents: appliedSellPrice,
      currentMarginPercent: decision.marginPercent,
      health: healthFrom(decision, decision.marginPercent, monitor.minMarginPercent),
      lastAction,
      lastReason: switched ? `Auto-switched supplier; ${decision.reason}` : decision.reason,
      lastCheckedAt: ts,
      updatedAt: ts,
    })
    .where(eq(listingMonitors.candidateId, monitor.candidateId));

  await db.insert(listingPriceHistory).values({
    id: newId(),
    candidateId: candidate.id,
    supplierCostCents,
    sellPriceCents: appliedSellPrice,
    marginPercent: decision.marginPercent,
    stockStatus,
    capturedAt: ts,
  });

  return lastAction;
}

/**
 * Batch entry point for the cron: monitors enabled listings due for a re-check.
 * Bounded per run to stay inside a scheduled-worker budget.
 */
export async function monitorDue(env: Env, db: Database, limit = 50): Promise<{ checked: number }> {
  const cutoff = now() - RECHECK_INTERVAL_MS;
  const due = await db
    .select()
    .from(listingMonitors)
    .where(and(eq(listingMonitors.enabled, 1), or(isNull(listingMonitors.lastCheckedAt), lt(listingMonitors.lastCheckedAt, cutoff))))
    .limit(limit);

  let checked = 0;
  for (const monitor of due) {
    const [candidate] = await db.select().from(productCandidates).where(eq(productCandidates.id, monitor.candidateId));
    if (!candidate) continue;
    try {
      await monitorOne(env, db, monitor, candidate);
      checked++;
    } catch (err) {
      console.error(`[monitor] ${monitor.candidateId} failed:`, err);
    }
  }
  return { checked };
}
