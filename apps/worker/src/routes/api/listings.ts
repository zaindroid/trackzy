import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, listings, storefronts } from '@fulfillment-tracker/db';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';
import { createOrderSourceForStorefront } from '../../lib/orderSourceForStorefront.js';

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

  const rows = await db.select().from(listings).where(inArray(listings.storefrontId, storefrontIds));
  return c.json({ listings: rows });
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
