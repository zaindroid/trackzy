import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { createDb, listingMonitors, productCandidates, sellerSettings } from '@sourcing/db';
import { createEbayListingClient } from '@fulfillment-tracker/adapters/ebayListing';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';
import { getFreshEbayToken } from '../../lib/ebayConnection.js';
import { notifyTrackzy } from '../../lib/trackzyHandoff.js';
import { CREDIT_COSTS, InsufficientCreditsError, addCredits, spendCredits } from '../../lib/credits.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const LISTING_QUANTITY = 10;

async function loadDraft(db: ReturnType<typeof createDb>, userId: string, id: string) {
  const [candidate] = await db
    .select()
    .from(productCandidates)
    .where(and(eq(productCandidates.id, id), eq(productCandidates.userId, userId)));
  return candidate;
}

const editSchema = z.object({
  generatedTitle: z.string().min(1).optional(),
  generatedDescription: z.string().min(1).optional(),
  suggestedSellPriceCents: z.number().int().positive().optional(),
  categoryId: z.string().min(1).optional(),
});

app.patch('/:id', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const candidate = await loadDraft(db, c.get('userId'), c.req.param('id'));
  if (!candidate) return errorResponse(c, 'NOT_FOUND', 'Candidate not found', 404);
  if (candidate.status !== 'draft') return errorResponse(c, 'INVALID_STATE', 'Only draft candidates can be edited', 409);

  const parsed = editSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);

  await db.update(productCandidates).set({ ...parsed.data, updatedAt: now() }).where(eq(productCandidates.id, candidate.id));
  return c.json({ ok: true });
});

app.post('/:id/dismiss', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const candidate = await loadDraft(db, c.get('userId'), c.req.param('id'));
  if (!candidate) return errorResponse(c, 'NOT_FOUND', 'Candidate not found', 404);
  await db.update(productCandidates).set({ status: 'dismissed', updatedAt: now() }).where(eq(productCandidates.id, candidate.id));
  return c.json({ ok: true });
});

/**
 * The one-click publish: takes an already-researched, margin-checked,
 * content-generated draft and creates the live eBay listing (Trading API
 * AddFixedPriceItem), then best-effort tells trackzy the supplier mapping so
 * fulfillment is deterministic. Idempotent against a double-click via the
 * status guard.
 */
app.post('/:id/list', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const candidate = await loadDraft(db, userId, c.req.param('id'));
  if (!candidate) return errorResponse(c, 'NOT_FOUND', 'Candidate not found', 404);
  if (candidate.status === 'listed') return errorResponse(c, 'ALREADY_LISTED', 'This candidate is already listed', 409);
  if (candidate.status !== 'draft') return errorResponse(c, 'INVALID_STATE', 'Only draft candidates can be listed', 409);

  const accessToken = await getFreshEbayToken(c.env, db, userId);
  if (!accessToken) return errorResponse(c, 'NO_EBAY', 'Connect your eBay account before listing', 400);

  // Charge for the listing; refunded below if eBay rejects it, so a failed
  // publish is free.
  try {
    await spendCredits(db, userId, CREDIT_COSTS.list, 'list', candidate.id);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return errorResponse(c, 'INSUFFICIENT_CREDITS', 'Not enough credits to list — top up to continue.', 402);
    }
    throw err;
  }

  const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
  const listing = createEbayListingClient(c.env);

  let categoryId = candidate.categoryId;
  if (!categoryId) {
    try {
      const suggestion = await listing.suggestCategory(accessToken, candidate.generatedTitle);
      categoryId = suggestion?.categoryId ?? null;
    } catch (err) {
      // Don't let a Taxonomy failure escape as an unhandled 500 (which the UI
      // can't parse into a message) — surface it as a clean error instead.
      await addCredits(db, userId, CREDIT_COSTS.list, 'refund', candidate.id).catch(() => {});
      return errorResponse(c, 'CATEGORY_LOOKUP_FAILED', err instanceof Error ? err.message : 'eBay category lookup failed', 502);
    }
  }
  if (!categoryId) {
    await addCredits(db, userId, CREDIT_COSTS.list, 'refund', candidate.id).catch(() => {});
    return errorResponse(c, 'NO_CATEGORY', 'Could not determine an eBay category for this item', 422);
  }

  const sku = candidate.sku ?? `SRC-${candidate.id}`;
  const imageUrls = JSON.parse(candidate.supplierImageUrlsJson) as string[];
  const aspects = JSON.parse(candidate.generatedAspectsJson) as Record<string, string>;

  let ebayItemId: string;
  try {
    const result = await listing.createFixedPriceListing({
      accessToken,
      sku,
      title: candidate.generatedTitle,
      description: candidate.generatedDescription,
      priceCents: candidate.suggestedSellPriceCents,
      quantity: LISTING_QUANTITY,
      categoryId,
      imageUrls,
      aspects,
      condition: 'New',
      shippingCostCents: settings?.defaultShippingCostCents ?? 0,
      handlingTimeDays: settings?.handlingTimeDays ?? 3,
      returnPolicy: settings?.returnPolicy ?? '30_day',
      itemLocationPostalCode: settings?.itemLocationPostalCode ?? '10001',
    });
    ebayItemId = result.ebayItemId;
  } catch (err) {
    await addCredits(db, userId, CREDIT_COSTS.list, 'refund', candidate.id).catch(() => {});
    return errorResponse(c, 'LISTING_FAILED', err instanceof Error ? err.message : 'eBay rejected the listing', 502);
  }

  await db
    .update(productCandidates)
    .set({ status: 'listed', ebayItemId, sku, categoryId, updatedAt: now() })
    .where(eq(productCandidates.id, candidate.id));

  // Auto-enable price/stock monitoring for the freshly-listed product.
  await db
    .insert(listingMonitors)
    .values({
      candidateId: candidate.id,
      userId,
      enabled: 1,
      minMarginPercent: settings?.targetMarginPercent ?? 20,
      currentSellPriceCents: candidate.suggestedSellPriceCents,
      currentSupplierCostCents: candidate.supplierCostCents,
      createdAt: now(),
      updatedAt: now(),
    })
    .onConflictDoNothing()
    .catch((err) => console.error('[list] monitor enroll failed:', err));

  await notifyTrackzy(c.env, c.req.header('Authorization'), {
    ebayItemId,
    sku,
    supplierProvider: candidate.supplierProvider,
    supplierProductId: candidate.supplierProductId,
    costCents: candidate.supplierCostCents,
    imageUrl: imageUrls[0],
    title: candidate.generatedTitle,
    priceCents: candidate.suggestedSellPriceCents,
  });

  return c.json({ ebayItemId, sku });
});

export default app;
