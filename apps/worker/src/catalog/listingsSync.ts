import { and, eq, inArray } from 'drizzle-orm';
import { createDb, listings, storefronts, type Database } from '@fulfillment-tracker/db';
import type { OrderSource } from '@fulfillment-tracker/adapters/orderSource';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { matchListing } from './matchListing.js';
import { createOrderSourceForStorefront } from '../lib/orderSourceForStorefront.js';

/**
 * Pulls a storefront's existing marketplace listings in via
 * `OrderSource.listListings()` (read-only — this app never creates or
 * publishes a listing, see DEPLOY.md) and upserts them into `listings`,
 * matched by `storefrontId` + `externalListingId`. Every listing that isn't
 * matched to a supplier yet is run through the existing match cascade
 * (`matchListing.ts`). Without this, a newly-connected customer's
 * `listings` table stays empty forever — nothing else in this codebase
 * calls `listListings()` — and every incoming order falls to `exception`
 * for lack of any listing/supplier match at all (see DECISIONS.md).
 */
export async function syncListingsForStorefront(env: Env, db: Database, storefrontId: string, orderSource: OrderSource): Promise<void> {
  const sourceListings = await orderSource.listListings();

  for (const sl of sourceListings) {
    const [existing] = await db
      .select({ id: listings.id, supplierId: listings.supplierId })
      .from(listings)
      .where(and(eq(listings.storefrontId, storefrontId), eq(listings.externalListingId, sl.externalListingId)))
      .limit(1);

    let listingId: string;
    if (existing) {
      listingId = existing.id;
      await db
        .update(listings)
        .set({
          sku: sl.sku,
          title: sl.title,
          priceCents: sl.priceCents,
          quantityAvailable: sl.quantityAvailable,
          updatedAt: now(),
        })
        .where(eq(listings.id, listingId));
    } else {
      listingId = newId();
      await db.insert(listings).values({
        id: listingId,
        storefrontId,
        externalListingId: sl.externalListingId,
        sku: sl.sku,
        title: sl.title,
        priceCents: sl.priceCents,
        quantityAvailable: sl.quantityAvailable,
        supplierId: null,
        supplierProductId: null,
        matchConfidence: null,
        matchSource: null,
        autoReprice: 1,
        autoPause: 1,
        status: 'active',
        createdAt: now(),
        updatedAt: now(),
      });
    }

    if (!existing?.supplierId) {
      try {
        await matchListing(env, listingId);
      } catch (err) {
        // Best-effort per listing — one bad match attempt (a flaky supplier
        // search call, a Gemini hiccup) shouldn't stop every other listing
        // in this same sync pass from being pulled in and matched.
        console.error(`[listingsSync] matchListing failed for listing ${listingId}:`, err);
      }
    }
  }
}

/**
 * Syncs every connected eBay/Amazon storefront across every tenant — the
 * background job behind `LISTINGS_SYNC_CRON` (see scheduled.ts). Runs on a
 * much tighter interval than order polling (minutes, not 10) specifically
 * so a customer who just created a new eBay listing sees it picked up
 * (and, if a supplier's already connected, auto-matched) without a long
 * wait — see DECISIONS.md for why 10 minutes wasn't good enough here.
 */
export async function syncAllListings(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const mpStorefronts = await db.select().from(storefronts).where(inArray(storefronts.platform, ['ebay', 'amazon']));

  for (const storefront of mpStorefronts) {
    const orderSource = await createOrderSourceForStorefront(env, db, storefront);
    if (!orderSource) continue; // no OAuth configured yet for this storefront

    try {
      await syncListingsForStorefront(env, db, storefront.id, orderSource);
    } catch (err) {
      console.error(`[listingsSync] sync failed for storefront ${storefront.id}:`, err);
    }
  }
}
