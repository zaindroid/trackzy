import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { createDb, productCandidates, researchRuns } from '@sourcing/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { runResearch } from '../../research/pipeline.js';
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
 * Runs a research session synchronously (bounded fan-out — see pipeline.ts)
 * and returns the resulting candidates. Persisted regardless, so a slow/failed
 * client still finds them under GET / afterwards.
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

  // ASYNC: create the run row now, return its id immediately, and process in the
  // background (waitUntil) so the request isn't held for the 30-90s of a deep
  // search. The client polls GET /runs/:id, then refetches candidates. This
  // decouples the browser from the long crawl and keeps the portal responsive
  // under concurrent load.
  const runId = newId();
  await db.insert(researchRuns).values({ id: runId, userId, seed, status: 'running', createdAt: now() });

  const job = (async () => {
    try {
      await runResearch(c.env, db, userId, seed, supplier, runId);
    } catch (err) {
      // runResearch already marks the run 'failed'; refund the credit here.
      await addCredits(db, userId, CREDIT_COSTS.research, 'refund', 'research-failed').catch(() => {});
      console.error(`[research] run ${runId} failed:`, err);
    }
  })();
  c.executionCtx.waitUntil(job);

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

app.get('/runs/:id', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const [run] = await db
    .select()
    .from(researchRuns)
    .where(and(eq(researchRuns.id, c.req.param('id')), eq(researchRuns.userId, c.get('userId'))));
  if (!run) return errorResponse(c, 'NOT_FOUND', 'Run not found', 404);
  return c.json({ run });
});

export default app;
