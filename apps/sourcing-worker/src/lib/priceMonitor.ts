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
// Quantity restored when a paused listing is re-listed after an approved switch.
// Kept in sync with candidates.ts's LISTING_QUANTITY (the value used at list time).
const LISTING_QUANTITY = 10;

function healthFrom(decision: RepriceDecision, marginPercent: number, minMargin: number): Monitor['health'] {
  if (decision.action === 'pause_oos' || decision.action === 'pause_unprofitable') return 'paused';
  if (marginPercent < minMargin) return 'critical';
  if (marginPercent < minMargin + 5) return 'warning';
  return 'healthy';
}

/**
 * Monitors ONE listed product: re-fetch supplier cost + stock (free DS call, no
 * ScraperAPI credit), decide the smart action, apply it to the live eBay listing,
 * and log the price-history point. Fully isolated — one listing's failure never
 * affects the batch. Returns the action taken (for logging).
 *
 * On a stock-out we do NOT silently adopt an alternative supplier: matching the
 * exact same product from a keyword search is error-prone, and quietly shipping
 * the wrong item is worse than a brief pause. Instead we follow the platform's
 * one-click-approval philosophy — PAUSE the listing (safe default) and stash a
 * *candidate* replacement supplier as a pending proposal for the seller to
 * approve (adopt + relist) or reject (stay paused). See approveSupplierSwitch.
 */
export async function monitorOne(env: Env, db: Database, monitor: Monitor, candidate: Candidate): Promise<string> {
  const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, monitor.userId));
  const ebayFeePercent = settings?.ebayFeePercent ?? 13.25;
  const ds = createAliexpressDsClient(env);

  const status = await ds.getProductStatus(candidate.supplierProductId).catch(() => null);
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

  // On a stock-out, look for a candidate replacement supplier to PROPOSE (never
  // adopt). Only when we don't already have an unresolved proposal outstanding.
  let proposal: { productId: string; costCents: number; url: string | null; imageUrl: string | null; title: string } | null = null;
  if (!inStock && !monitor.suggestedSupplierProductId) {
    proposal = await findReplacementCandidate(ds, candidate);
  }

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
  const ts = now();
  const proposed = proposal != null;
  const lastAction = proposed ? 'switch_proposed' : decision.action;
  const lastReason = proposed
    ? `Out of stock — paused. Found a possible replacement supplier awaiting your approval.`
    : decision.reason;
  await db
    .update(listingMonitors)
    .set({
      stockStatus,
      currentSupplierCostCents: supplierCostCents,
      currentSellPriceCents: appliedSellPrice,
      currentMarginPercent: decision.marginPercent,
      health: healthFrom(decision, decision.marginPercent, monitor.minMarginPercent),
      lastAction,
      lastReason,
      lastCheckedAt: ts,
      // Stash the proposal (if any) for one-click approve/reject.
      ...(proposal
        ? {
            suggestedSupplierProductId: proposal.productId,
            suggestedSupplierCostCents: proposal.costCents,
            suggestedSupplierUrl: proposal.url,
            suggestedSupplierImageUrl: proposal.imageUrl,
            suggestedSupplierTitle: proposal.title,
            suggestedAt: ts,
          }
        : {}),
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

type Ds = ReturnType<typeof createAliexpressDsClient>;

/**
 * Searches the same niche for an in-stock, sourceable alternative to a
 * stocked-out product — returned as a *proposal* only (never adopted here).
 * The seller confirms it's genuinely the same product via one-click approve.
 */
async function findReplacementCandidate(
  ds: Ds,
  candidate: Candidate,
): Promise<{ productId: string; costCents: number; url: string | null; imageUrl: string | null; title: string } | null> {
  const alts = await ds.searchProducts(candidate.keyword, 8).catch(() => []);
  for (const alt of alts) {
    if (alt.productId === candidate.supplierProductId || alt.costCents <= 0) continue;
    const altStatus = await ds.getProductStatus(alt.productId).catch(() => null);
    if (altStatus?.inStock) {
      return {
        productId: alt.productId,
        costCents: alt.costCents,
        url: alt.productUrl ?? null,
        imageUrl: alt.imageUrl ?? alt.imageUrls[0] ?? null,
        title: alt.title,
      };
    }
  }
  return null;
}

/**
 * One-click APPROVE of a pending supplier switch: adopt the proposed supplier on
 * the candidate, clear the proposal, re-price against the new cost, and re-list
 * (restore quantity) on eBay. The seller has confirmed it's the same product.
 * Returns the resulting action, or null if there was no pending proposal.
 */
export async function approveSupplierSwitch(env: Env, db: Database, monitor: Monitor, candidate: Candidate): Promise<string | null> {
  if (!monitor.suggestedSupplierProductId || monitor.suggestedSupplierCostCents == null) return null;
  const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, monitor.userId));
  const ebayFeePercent = settings?.ebayFeePercent ?? 13.25;

  const newProductId = monitor.suggestedSupplierProductId;
  const newCostCents = monitor.suggestedSupplierCostCents;

  // Adopt the supplier on the candidate.
  await db
    .update(productCandidates)
    .set({ supplierProductId: newProductId, supplierCostCents: newCostCents, supplierProductUrl: monitor.suggestedSupplierUrl ?? candidate.supplierProductUrl, updatedAt: now() })
    .where(eq(productCandidates.id, candidate.id));

  const decision = decideReprice({
    supplierCostCents: newCostCents,
    inStock: true,
    currentSellPriceCents: candidate.suggestedSellPriceCents,
    competitorMedianCents: candidate.ebayMedianPriceCents,
    ebayFeePercent,
    fulfillmentShippingCents: 0,
    minMarginPercent: monitor.minMarginPercent,
    priceCeilingCents: monitor.priceCeilingCents,
  });

  const accessToken = candidate.ebayItemId ? await getFreshEbayToken(env, db, monitor.userId).catch(() => null) : null;
  const listing = createEbayListingClient(env);
  let appliedSellPrice = candidate.suggestedSellPriceCents;
  try {
    if (accessToken && candidate.ebayItemId) {
      const newPrice = decision.action === 'reprice' ? decision.newSellPriceCents : candidate.suggestedSellPriceCents;
      if (decision.action === 'reprice') {
        await listing.reviseListingPrice(accessToken, candidate.ebayItemId, newPrice);
        appliedSellPrice = newPrice;
        await db.update(productCandidates).set({ suggestedSellPriceCents: newPrice, updatedAt: now() }).where(eq(productCandidates.id, candidate.id));
      }
      // Re-list: restore quantity so the paused listing goes live on the new supplier.
      await listing.setListingQuantity(accessToken, candidate.ebayItemId, LISTING_QUANTITY);
    }
  } catch (err) {
    console.error(`[monitor] relist after switch failed for ${candidate.id}:`, err);
  }

  const ts = now();
  await db
    .update(listingMonitors)
    .set({
      stockStatus: 'in',
      currentSupplierCostCents: newCostCents,
      currentSellPriceCents: appliedSellPrice,
      currentMarginPercent: decision.marginPercent,
      health: healthFrom(decision, decision.marginPercent, monitor.minMarginPercent),
      lastAction: 'switch_approved',
      lastReason: 'You approved a new supplier — listing re-priced and re-listed.',
      lastCheckedAt: ts,
      ...clearProposal(),
      updatedAt: ts,
    })
    .where(eq(listingMonitors.candidateId, monitor.candidateId));

  await db.insert(listingPriceHistory).values({
    id: newId(),
    candidateId: candidate.id,
    supplierCostCents: newCostCents,
    sellPriceCents: appliedSellPrice,
    marginPercent: decision.marginPercent,
    stockStatus: 'in',
    capturedAt: ts,
  });

  return 'switch_approved';
}

/**
 * One-click REJECT of a pending supplier switch: discard the proposal and leave
 * the listing paused (the safe state it's already in). The seller decided the
 * candidate wasn't the same product.
 */
export async function rejectSupplierSwitch(db: Database, monitor: Monitor): Promise<void> {
  const ts = now();
  await db
    .update(listingMonitors)
    .set({
      lastAction: 'switch_rejected',
      lastReason: 'You dismissed the replacement supplier — listing stays paused until stock returns or you relist.',
      ...clearProposal(),
      updatedAt: ts,
    })
    .where(eq(listingMonitors.candidateId, monitor.candidateId));
}

/** The columns that clear a pending supplier-switch proposal. */
function clearProposal() {
  return {
    suggestedSupplierProductId: null,
    suggestedSupplierCostCents: null,
    suggestedSupplierUrl: null,
    suggestedSupplierImageUrl: null,
    suggestedSupplierTitle: null,
    suggestedAt: null,
  };
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
