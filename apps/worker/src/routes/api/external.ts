import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { createDb, listings, storefronts, supplierOffers, suppliers } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const sourcedListingSchema = z.object({
  ebayItemId: z.string().min(1),
  sku: z.string().min(1),
  supplierProvider: z.string().min(1),
  supplierProductId: z.string().min(1),
  costCents: z.number().int().nonnegative(),
  imageUrl: z.string().optional(),
  title: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
});

/**
 * The linkage from the separate sourcing portal (see DECISIONS.md / the plan):
 * when that product publishes a listing on the seller's eBay account, it calls
 * this — authenticated with the same shared-Clerk bearer token, so
 * authMiddleware resolves the same user here. We pre-seed a `listings` row
 * (keyed on the eBay ItemID the sourcing side just created) already matched to
 * the sourced supplier product + cost, so trackzy's own `GetMyeBaySelling`
 * sync finds a *deterministic* match instead of re-deriving one (unreliable
 * for some suppliers). Best-effort by design: if the seller hasn't also
 * connected eBay + the supplier in trackzy, we no-op (`linked: false`) rather
 * than error — the normal sync/match path still handles the listing later.
 */
app.post('/sourced-listing', async (c) => {
  const parsed = sourcedListingSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  const payload = parsed.data;

  const db = createDb(c.env.DB);
  const userId = c.get('userId');

  const [storefront] = await db.select().from(storefronts).where(and(eq(storefronts.userId, userId), eq(storefronts.platform, 'ebay')));
  if (!storefront) return c.json({ ok: true, linked: false, reason: 'no eBay storefront connected in trackzy' });

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.userId, userId), eq(suppliers.provider, payload.supplierProvider as 'cj')));
  if (!supplier) return c.json({ ok: true, linked: false, reason: `no ${payload.supplierProvider} supplier connected in trackzy` });

  // Upsert the listing keyed on the eBay ItemID (what GetMyeBaySelling reports).
  const [existingListing] = await db
    .select()
    .from(listings)
    .where(and(eq(listings.storefrontId, storefront.id), eq(listings.externalListingId, payload.ebayItemId)));

  let listingId: string;
  if (existingListing) {
    listingId = existingListing.id;
    await db
      .update(listings)
      .set({ sku: payload.sku, supplierId: supplier.id, supplierProductId: payload.supplierProductId, matchConfidence: 1, matchSource: 'manual', updatedAt: now() })
      .where(eq(listings.id, listingId));
  } else {
    listingId = newId();
    await db.insert(listings).values({
      id: listingId,
      storefrontId: storefront.id,
      externalListingId: payload.ebayItemId,
      sku: payload.sku,
      title: payload.title,
      priceCents: payload.priceCents,
      quantityAvailable: 0,
      supplierId: supplier.id,
      supplierProductId: payload.supplierProductId,
      matchConfidence: 1,
      matchSource: 'manual',
      autoReprice: 1,
      autoPause: 1,
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    });
  }

  const [existingOffer] = await db
    .select()
    .from(supplierOffers)
    .where(and(eq(supplierOffers.listingId, listingId), eq(supplierOffers.supplierId, supplier.id)));
  const offerValues = {
    costCents: payload.costCents,
    shippingCents: 0,
    inStock: 1,
    shipDays: null,
    score: 1,
    checkedAt: now(),
    productTitle: payload.title,
    productImageUrl: payload.imageUrl ?? null,
    productUrl: null,
  };
  if (existingOffer) {
    await db.update(supplierOffers).set(offerValues).where(eq(supplierOffers.id, existingOffer.id));
  } else {
    await db.insert(supplierOffers).values({ id: newId(), listingId, supplierId: supplier.id, supplierProductId: payload.supplierProductId, ...offerValues });
  }

  return c.json({ ok: true, linked: true });
});

export default app;
