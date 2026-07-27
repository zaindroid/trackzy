import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { createDb, productCandidates, researchRuns } from '@sourcing/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { runResearch } from '../../research/pipeline.js';
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

  // Charge a credit up front; refund it if the run fails so a failure is free.
  try {
    await spendCredits(db, userId, CREDIT_COSTS.research, 'research');
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return errorResponse(c, 'INSUFFICIENT_CREDITS', 'Not enough credits to run research — top up to continue.', 402);
    }
    throw err;
  }

  let runId: string;
  try {
    runId = await runResearch(c.env, db, userId, parsed.data.seed, parsed.data.supplier);
  } catch (err) {
    await addCredits(db, userId, CREDIT_COSTS.research, 'refund', 'research-failed').catch(() => {});
    const raw = err instanceof Error ? err.message : 'Research failed';
    // Surface Apify quota exhaustion as a plain-language message rather than the
    // raw actor error — it's an account/billing condition, not a bug.
    const message = /usage hard limit|platform-feature-disabled|monthly usage/i.test(raw)
      ? 'AliExpress sourcing is temporarily unavailable: the Apify scraping quota for this account has been reached. Add credits to the Apify plan, or try again after it resets.'
      : raw;
    return errorResponse(c, 'RESEARCH_FAILED', message, 502);
  }

  const rows = await db
    .select()
    .from(productCandidates)
    .where(and(eq(productCandidates.userId, userId), eq(productCandidates.runId, runId)))
    .orderBy(desc(productCandidates.marginCents));
  return c.json({ runId, candidates: withParsedJson(rows) });
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
