import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createDb, listingMonitors, listingPriceHistory, productCandidates } from '@sourcing/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';
import { monitorOne } from '../../lib/priceMonitor.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

/** The user's monitored listings with health, live margin/stock, and a price
 * trend sparkline — the "keep it profitable" dashboard. */
app.get('/', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const monitors = await db.select().from(listingMonitors).where(eq(listingMonitors.userId, userId)).orderBy(desc(listingMonitors.updatedAt));
  if (monitors.length === 0) return c.json({ monitors: [] });

  const ids = monitors.map((m) => m.candidateId);
  const cands = await db.select().from(productCandidates).where(inArray(productCandidates.id, ids));
  const candById = new Map(cands.map((c) => [c.id, c]));
  const history = await db.select().from(listingPriceHistory).where(inArray(listingPriceHistory.candidateId, ids)).orderBy(desc(listingPriceHistory.capturedAt));
  const sparkById = new Map<string, number[]>();
  for (const h of history) {
    const arr = sparkById.get(h.candidateId) ?? [];
    if (arr.length < 10) arr.push(h.marginPercent);
    sparkById.set(h.candidateId, arr);
  }

  return c.json({
    monitors: monitors.map((m) => {
      const cand = candById.get(m.candidateId);
      return {
        candidateId: m.candidateId,
        title: cand?.generatedTitle ?? m.candidateId,
        imageUrl: cand ? (JSON.parse(cand.supplierImageUrlsJson) as string[])[0] ?? null : null,
        ebayItemId: cand?.ebayItemId ?? null,
        enabled: m.enabled === 1,
        health: m.health,
        stockStatus: m.stockStatus,
        minMarginPercent: m.minMarginPercent,
        priceCeilingCents: m.priceCeilingCents,
        currentSellPriceCents: m.currentSellPriceCents,
        currentSupplierCostCents: m.currentSupplierCostCents,
        currentMarginPercent: m.currentMarginPercent,
        lastAction: m.lastAction,
        lastReason: m.lastReason,
        lastCheckedAt: m.lastCheckedAt,
        marginSpark: (sparkById.get(m.candidateId) ?? []).reverse(), // chronological
      };
    }),
  });
});

const configSchema = z.object({
  enabled: z.boolean().optional(),
  minMarginPercent: z.number().min(0).max(95).optional(),
  priceCeilingCents: z.number().int().positive().nullable().optional(),
});

/** Update a monitor's rules (floor margin, ceiling, on/off). */
app.patch('/:candidateId', async (c) => {
  const parsed = configSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const candidateId = c.req.param('candidateId');
  const [existing] = await db.select().from(listingMonitors).where(and(eq(listingMonitors.candidateId, candidateId), eq(listingMonitors.userId, userId)));
  if (!existing) return errorResponse(c, 'NOT_FOUND', 'Monitor not found', 404);

  const patch: Record<string, unknown> = { updatedAt: now() };
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled ? 1 : 0;
  if (parsed.data.minMarginPercent !== undefined) patch.minMarginPercent = parsed.data.minMarginPercent;
  if (parsed.data.priceCeilingCents !== undefined) patch.priceCeilingCents = parsed.data.priceCeilingCents;
  await db.update(listingMonitors).set(patch).where(eq(listingMonitors.candidateId, candidateId));
  return c.json({ ok: true });
});

/** Run a monitor check right now (manual refresh from the dashboard). */
app.post('/:candidateId/check', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const candidateId = c.req.param('candidateId');
  const [monitor] = await db.select().from(listingMonitors).where(and(eq(listingMonitors.candidateId, candidateId), eq(listingMonitors.userId, userId)));
  if (!monitor) return errorResponse(c, 'NOT_FOUND', 'Monitor not found', 404);
  const [candidate] = await db.select().from(productCandidates).where(eq(productCandidates.id, candidateId));
  if (!candidate) return errorResponse(c, 'NOT_FOUND', 'Listing not found', 404);
  const action = await monitorOne(c.env, db, monitor, candidate);
  return c.json({ ok: true, action });
});

export default app;
