import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { createDb, productCandidates, researchRuns } from '@sourcing/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { initResearchState, stepResearch } from '../../research/pipeline.js';
import { newId, now } from '../../lib/id.js';
import { CREDIT_COSTS, InsufficientCreditsError, addCredits, spendCredits } from '../../lib/credits.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

function withParsedJson(rows: (typeof productCandidates.$inferSelect)[]) {
  return rows.map((r) => ({
    ...r,
    supplierImageUrls: JSON.parse(r.supplierImageUrlsJson) as string[],
    generatedAspects: JSON.parse(r.generatedAspectsJson) as Record<string, string>,
  }));
}

const searchSchema = z.object({ seed: z.string().min(1), supplier: z.enum(['cj', 'aliexpress']).default('aliexpress') });

/**
 * Kicks off a research session and returns its run id immediately. The actual
 * deep search happens step-by-step, driven by the dashboard's poll loop (see
 * GET /runs/:id below) — not a single big background job. Persisted
 * regardless, so a slow/failed client still finds results under GET / after.
 */
app.post('/research', async (c) => {
  const parsed = searchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);

  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const { seed, supplier } = parsed.data;

  // Charge a credit up front; refunded if the run fails so a failure is free.
  try {
    await spendCredits(db, userId, CREDIT_COSTS.research, 'research');
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return errorResponse(c, 'INSUFFICIENT_CREDITS', 'Not enough credits to run research — top up to continue.', 402);
    }
    throw err;
  }

  const runId = newId();
  const state = initResearchState(seed, supplier);
  await db.insert(researchRuns).values({ id: runId, userId, seed, status: 'running', stateJson: JSON.stringify(state), createdAt: now() });

  return c.json({ runId, status: 'running' }, 202);
});

app.get('/', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const rows = await db
    .select()
    .from(productCandidates)
    .where(eq(productCandidates.userId, c.get('userId')))
    .orderBy(desc(productCandidates.createdAt));
  return c.json({ candidates: withParsedJson(rows) });
});

/** Clears the research feed: dismisses every still-draft candidate for the user
 * (listed items are kept — they're live on eBay). */
app.post('/clear', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  await db
    .update(productCandidates)
    .set({ status: 'dismissed', updatedAt: Date.now() })
    .where(and(eq(productCandidates.userId, c.get('userId')), eq(productCandidates.status, 'draft')));
  return c.json({ ok: true });
});

/**
 * Reports run status — and, deliberately, ALSO drives it forward: while a run
 * is 'running' this advances it by one bounded step before responding (see
 * stepResearch/STEP_ITEM_BUDGET in pipeline.ts). A GET normally shouldn't have
 * side effects, but this reuses the dashboard's existing 2.5s poll loop as the
 * pipeline's engine instead of a `waitUntil()` background job — deliberately,
 * so no single request ever needs more than a couple of short network calls,
 * sidestepping Cloudflare's ~30s background-execution ceiling entirely.
 */
app.get('/runs/:id', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.id, c.req.param('id')), eq(researchRuns.userId, userId)));
  if (!run) return errorResponse(c, 'NOT_FOUND', 'Run not found', 404);

  if (run.status === 'running') {
    try {
      await stepResearch(c.env, db, userId, run);
    } catch (err) {
      // stepResearch already marked the run 'failed'; refund the credit here.
      await addCredits(db, userId, CREDIT_COSTS.research, 'refund', 'research-failed').catch(() => {});
      console.error(`[research] run ${run.id} failed:`, err);
    }
    const [updated] = await db.select().from(researchRuns).where(eq(researchRuns.id, run.id));
    return c.json({ run: updated });
  }

  return c.json({ run });
});

export default app;
