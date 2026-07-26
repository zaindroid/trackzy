import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb, listings, storefronts, supplierOffers, suppliers } from '@fulfillment-tracker/db';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';
import { createOrderSourceForStorefront } from '../../lib/orderSourceForStorefront.js';
import { syncListingsForStorefront } from '../../catalog/listingsSync.js';
import { applyManualMatch, findMatchCandidates } from '../../catalog/matchListing.js';

/**
 * Listing title optimization (post-build feature, added at the user's
 * explicit request — the fifth authorized Gemini call site; see
 * DECISIONS.md and packages/adapters/src/gemini/iface.ts). Deliberately
 * two-step: `optimize-title` only generates and persists a suggestion,
 * `apply-title` is a separate, explicit human action that pushes it to the
 * real marketplace listing — an LLM-generated title is never auto-applied
 * to something buyers see without a human choosing to apply it.
 */
const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

async function userStorefrontIds(db: ReturnType<typeof createDb>, userId: string): Promise<string[]> {
  const rows = await db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.userId, userId));
  return rows.map((r) => r.id);
}

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const storefrontIds = await userStorefrontIds(db, c.get('userId'));
  if (storefrontIds.length === 0) return c.json({ listings: [] });

  // Left-joined so a human can actually see what product a match resolved
  // to (title + photo), not just an opaque supplierProductId — see
  // DECISIONS.md's manual-match review flow. `supplierId` on both sides
  // because a listing could theoretically have stale offer rows from a
  // supplier it's no longer matched to (e.g. after a manual re-match).
  const rows = await db
    .select({
      listing: listings,
      matchedProductTitle: supplierOffers.productTitle,
      matchedProductImageUrl: supplierOffers.productImageUrl,
      matchedProductUrl: supplierOffers.productUrl,
    })
    .from(listings)
    .leftJoin(supplierOffers, and(eq(supplierOffers.listingId, listings.id), eq(supplierOffers.supplierId, listings.supplierId)))
    .where(inArray(listings.storefrontId, storefrontIds));

  return c.json({
    listings: rows.map((r) => ({
      ...r.listing,
      matchedProductTitle: r.matchedProductTitle,
      matchedProductImageUrl: r.matchedProductImageUrl,
      matchedProductUrl: r.matchedProductUrl,
    })),
  });
});

/**
 * Manual "sync now" — the background cron (`LISTINGS_SYNC_CRON`, see
 * scheduled.ts) already covers this automatically every couple of minutes,
 * but a customer who just created a listing on eBay and wants to see it (or
 * a fresh match attempt) reflected immediately shouldn't have to wait for
 * the next tick. Syncs every one of the user's own marketplace storefronts
 * (currently just eBay/Amazon — Shopify has no `listListings()`/`OrderSource`
 * concept, see DECISIONS.md milestone 2) and returns how many listings each
 * one reported.
 */
app.post('/sync', async (c) => {
  const db = createDb(c.env.DB);
  const userStorefronts = await db.select().from(storefronts).where(eq(storefronts.userId, c.get('userId')));

  const results: { storefrontId: string; platform: string; synced: boolean }[] = [];
  for (const storefront of userStorefronts) {
    const orderSource = await createOrderSourceForStorefront(c.env, db, storefront);
    if (!orderSource) {
      results.push({ storefrontId: storefront.id, platform: storefront.platform, synced: false });
      continue;
    }
    await syncListingsForStorefront(c.env, db, storefront.id, orderSource);
    results.push({ storefrontId: storefront.id, platform: storefront.platform, synced: true });
  }

  return c.json({ storefronts: results });
});

/**
 * The manual-match resolution path (see DECISIONS.md): `matchListing()`'s
 * automatic cascade deliberately declines to commit a low-confidence guess,
 * which otherwise leaves a listing permanently "Unmatched" with no way to
 * fix it — these two endpoints are how a human resolves that from the
 * Listings page.
 */
app.get('/:id/candidates', async (c) => {
  const db = createDb(c.env.DB);
  const storefrontIds = await userStorefrontIds(db, c.get('userId'));
  const listingId = c.req.param('id');
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || !storefrontIds.includes(listing.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Listing not found', 404);
  }

  const candidates = await findMatchCandidates(c.env, listingId);
  return c.json({ candidates });
});

const applyMatchSchema = z.union([
  z.object({
    supplierId: z.string().min(1),
    supplierProductId: z.string().min(1),
    title: z.string().optional(),
    imageUrl: z.string().optional(),
    productUrl: z.string().optional(),
  }),
  z.object({ supplierId: z.null() }),
]);

app.post('/:id/match', async (c) => {
  const db = createDb(c.env.DB);
  const storefrontIds = await userStorefrontIds(db, c.get('userId'));
  const listingId = c.req.param('id');
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || !storefrontIds.includes(listing.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Listing not found', 404);
  }

  const parsed = applyMatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }

  if (parsed.data.supplierId === null) {
    await applyManualMatch(c.env, db, listingId, null);
    return c.json({ ok: true, supplierId: null });
  }

  const { supplierId, supplierProductId, title, imageUrl, productUrl } = parsed.data;
  const [supplier] = await db.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.userId, c.get('userId'))));
  if (!supplier) {
    return errorResponse(c, 'NOT_FOUND', 'Supplier not found', 404);
  }

  await applyManualMatch(c.env, db, listingId, { supplierId, supplierProductId, title, imageUrl, productUrl });
  return c.json({ ok: true, supplierId });
});

app.post('/:id/optimize-title', async (c) => {
  const db = createDb(c.env.DB);
  const storefrontIds = await userStorefrontIds(db, c.get('userId'));
  const listingId = c.req.param('id');
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || !storefrontIds.includes(listing.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Listing not found', 404);
  }

  const gemini = createGeminiExtractor(c.env);
  const suggestion = await gemini.suggestListingTitle({ currentTitle: listing.title });

  await db
    .update(listings)
    .set({
      suggestedTitle: suggestion.suggestedTitle,
      titleSuggestionReasoning: suggestion.reasoning,
      titleSuggestedAt: now(),
      updatedAt: now(),
    })
    .where(eq(listings.id, listingId));

  return c.json(suggestion);
});

app.post('/:id/apply-title', async (c) => {
  const db = createDb(c.env.DB);
  const storefrontIds = await userStorefrontIds(db, c.get('userId'));
  const listingId = c.req.param('id');
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing || !storefrontIds.includes(listing.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Listing not found', 404);
  }
  if (!listing.suggestedTitle) {
    return errorResponse(c, 'INVALID_STATE', 'No pending title suggestion to apply — call optimize-title first', 409);
  }

  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, listing.storefrontId));
  if (!storefront) {
    return errorResponse(c, 'NOT_FOUND', 'Storefront not found', 404);
  }
  const orderSource = await createOrderSourceForStorefront(c.env, db, storefront);
  if (!orderSource) {
    return errorResponse(c, 'INVALID_STATE', 'This storefront platform has no listing-update channel', 409);
  }

  await orderSource.updateListing(listing.externalListingId, { title: listing.suggestedTitle });

  await db
    .update(listings)
    .set({
      title: listing.suggestedTitle,
      suggestedTitle: null,
      titleSuggestionReasoning: null,
      titleSuggestedAt: null,
      updatedAt: now(),
    })
    .where(eq(listings.id, listingId));

  return c.json({ ok: true, title: listing.suggestedTitle });
});

export default app;
