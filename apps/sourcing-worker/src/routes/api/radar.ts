import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { createDb, radarProducts, sellerSettings } from '@sourcing/db';
import { computeListingMargin } from '@fulfillment-tracker/core';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

/**
 * Reads the global Product Radar table (written by the external crawler via
 * POST /ingest/radar) and returns it ranked. Margin is recomputed HERE with the
 * viewing seller's own fee/shipping settings (the stored margin uses a default
 * fee), so two sellers see numbers true to their own account. Sorting/filtering
 * is left to the client for responsiveness; default order is opportunityScore.
 */
app.get('/', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const [settings] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, c.get('userId')));
  const ebayFeePercent = settings?.ebayFeePercent ?? 13.25;

  const rows = await db.select().from(radarProducts).orderBy(desc(radarProducts.opportunityScore));

  const products = rows.map((r) => {
    // Recompute margin for THIS seller when we have both a sell price and a
    // supplier cost; otherwise fall back to the crawler's default-fee numbers.
    let marginCents = r.marginCents;
    let marginPercent = r.marginPercent;
    if (r.ebayMedianSoldPriceCents > 0 && r.aliexpressCostCents != null) {
      const m = computeListingMargin({
        sellPriceCents: r.ebayMedianSoldPriceCents,
        supplierCostCents: r.aliexpressCostCents,
        ebayFeePercent,
        fulfillmentShippingCents: 0,
      });
      marginCents = m.marginCents;
      marginPercent = m.marginPercent;
    }
    return {
      ...r,
      sourceable: r.sourceable === 1,
      marginCents,
      marginPercent,
    };
  });

  return c.json({ products, feePercentUsed: ebayFeePercent });
});

export default app;
