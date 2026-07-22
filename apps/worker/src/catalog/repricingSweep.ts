import { createDb, listings, settings, storefronts, supplierOffers, type Database } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { computeRepricing, shouldPauseForOutOfStock } from '@fulfillment-tracker/core';
import type { Env } from '../env.js';
import { now } from '../lib/id.js';
import { createOrderSourceForStorefront } from '../lib/orderSourceForStorefront.js';

// TODO(HUMAN): replace with real per-marketplace fee estimates (eBay final
// value fee is typically ~13% of the sale price; Amazon's referral fee
// varies by category, commonly 8-15%) — a flat $0 placeholder until then.
const DEFAULT_FEE_CENTS = 0;
const PRICE_CHANGE_THRESHOLD_PERCENT = 3;

/**
 * Hourly repricing + stock-sync sweep (spec section 10). Stock-out pausing
 * takes priority over repricing for a given listing — an out-of-stock
 * listing gets paused and skipped, not repriced against a supplier that
 * can't fulfill it.
 */
export async function runRepricingSweep(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const activeListings = await db.select().from(listings).where(eq(listings.status, 'active'));

  for (const listing of activeListings) {
    await processListing(env, db, listing);
  }
}

async function processListing(env: Env, db: Database, listing: typeof listings.$inferSelect): Promise<void> {
  const offers = await db.select().from(supplierOffers).where(eq(supplierOffers.listingId, listing.id));
  if (offers.length === 0) return; // no known supplier offers yet — nothing to act on

  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, listing.storefrontId));
  if (!storefront) return;

  if (listing.autoPause === 1 && shouldPauseForOutOfStock({ offersInStock: offers.map((o) => o.inStock === 1) })) {
    await pauseListing(env, db, listing, storefront);
    return;
  }

  if (listing.autoReprice !== 1) return;

  const bestOffer = offers.filter((o) => o.inStock === 1).sort((a, b) => a.costCents - b.costCents)[0];
  if (!bestOffer) return;

  const [userSettings] = await db.select().from(settings).where(eq(settings.userId, storefront.userId));
  const targetMarginPercent = userSettings?.minMarginPercent ?? 10;

  const repricing = computeRepricing({
    costCents: bestOffer.costCents,
    shippingCents: bestOffer.shippingCents,
    feeCents: DEFAULT_FEE_CENTS,
    targetMarginPercent,
    currentPriceCents: listing.priceCents,
    priceChangeThresholdPercent: PRICE_CHANGE_THRESHOLD_PERCENT,
  });

  if (!repricing.shouldUpdate) return;

  const orderSource = await createOrderSourceForStorefront(env, db, storefront);
  if (!orderSource) return; // e.g. Shopify — no OrderSource implementation to push a price update through

  await orderSource.updateListing(listing.externalListingId, { priceCents: repricing.targetPriceCents });
  await db.update(listings).set({ priceCents: repricing.targetPriceCents, updatedAt: now() }).where(eq(listings.id, listing.id));
}

async function pauseListing(
  env: Env,
  db: Database,
  listing: typeof listings.$inferSelect,
  storefront: typeof storefronts.$inferSelect,
): Promise<void> {
  const orderSource = await createOrderSourceForStorefront(env, db, storefront);
  if (orderSource) {
    await orderSource.pauseListing(listing.externalListingId).catch(() => undefined);
  }
  await db
    .update(listings)
    .set({ status: 'paused_out_of_stock', updatedAt: now() })
    .where(eq(listings.id, listing.id));
}
