import { Hono } from 'hono';
import { eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { apifyUsage, createDb, radarProducts, radarRuns, supplierCache } from '@sourcing/db';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';

const app = new Hono<{ Bindings: Env }>();

// Cloudflare D1 caps bound parameters at 100 PER QUERY. radar_products has 21
// columns, so a multi-row insert can carry at most floor(100/21)=4 rows.
const INSERT_CHUNK = 4;
// Max keys per cache-lookup IN(...) query, staying under the 100-param cap.
const LOOKUP_KEY_CHUNK = 90;
const DEFAULT_CACHE_TTL_DAYS = 10;
const DAY_MS = 86_400_000;

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function tokenMatches(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const provided = header?.replace(/^Bearer\s+/i, '') ?? '';
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// All ingest routes are for the external crawler (a CI job, no Clerk session),
// guarded by the shared RADAR_INGEST_TOKEN bearer secret.
app.use('*', async (c, next) => {
  if (!tokenMatches(c.req.header('Authorization'), c.env.RADAR_INGEST_TOKEN)) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or missing ingest token' } }, 401);
  }
  await next();
});

// ─────────────────────────── Radar results ────────────────────────────────

const itemSchema = z.object({
  id: z.string().min(1).optional(),
  niche: z.string().min(1),
  productTitle: z.string().min(1),
  imageUrl: z.string().url().nullish(),
  ebaySoldCount: z.number().int().nonnegative().default(0),
  salesPerDay: z.number().nonnegative().default(0),
  ebayActiveCount: z.number().int().nonnegative().default(0),
  sellThroughPercent: z.number().nonnegative().default(0),
  ebayMedianSoldPriceCents: z.number().int().nonnegative().default(0),
  aliexpressProductId: z.string().nullish(),
  aliexpressUrl: z.string().url().nullish(),
  aliexpressCostCents: z.number().int().nonnegative().nullish(),
  aliexpressRating: z.number().nullish(),
  aliexpressOrders: z.number().int().nonnegative().nullish(),
  sourceable: z.union([z.boolean(), z.number()]).nullish(),
  supplierCheck: z.enum(['ok', 'pending', 'none']).optional(),
  marginCents: z.number().int().default(0),
  marginPercent: z.number().default(0),
  opportunityScore: z.number().default(0),
});

const bodySchema = z.object({
  mode: z.enum(['replace', 'upsert']).default('replace'),
  items: z.array(itemSchema).max(2000),
});

/**
 * Ingest endpoint for the crawler. `mode:"replace"` (default) swaps the whole
 * table for a fresh snapshot; `"upsert"` updates/inserts by id.
 */
app.post('/', async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
  const { mode, items } = parsed.data;

  const db = createDb(c.env.SOURCING_DB);
  const runId = newId();
  const startedAt = now();
  await db.insert(radarRuns).values({ id: runId, startedAt, status: 'running', itemsWritten: 0 });

  try {
    const rows = items.map((it) => ({
      id: it.id ?? newId(),
      niche: it.niche,
      productTitle: it.productTitle,
      imageUrl: it.imageUrl ?? null,
      ebaySoldCount: it.ebaySoldCount,
      salesPerDay: it.salesPerDay,
      ebayActiveCount: it.ebayActiveCount,
      sellThroughPercent: it.sellThroughPercent,
      ebayMedianSoldPriceCents: it.ebayMedianSoldPriceCents,
      aliexpressProductId: it.aliexpressProductId ?? null,
      aliexpressUrl: it.aliexpressUrl ?? null,
      aliexpressCostCents: it.aliexpressCostCents ?? null,
      aliexpressRating: it.aliexpressRating ?? null,
      aliexpressOrders: it.aliexpressOrders ?? null,
      sourceable: it.sourceable ? 1 : 0,
      supplierCheck: it.supplierCheck ?? 'none',
      marginCents: it.marginCents,
      marginPercent: it.marginPercent,
      opportunityScore: it.opportunityScore,
      lastUpdated: startedAt,
      createdAt: startedAt,
    }));

    if (mode === 'replace') {
      await db.delete(radarProducts);
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await db.insert(radarProducts).values(rows.slice(i, i + INSERT_CHUNK));
      }
    } else {
      for (const row of rows) {
        const { id: _id, createdAt: _createdAt, ...updatable } = row;
        await db.insert(radarProducts).values(row).onConflictDoUpdate({ target: radarProducts.id, set: updatable });
      }
    }

    await db.update(radarRuns).set({ status: 'done', finishedAt: now(), itemsWritten: rows.length }).where(eq(radarRuns.id, runId));
    return c.json({ ok: true, mode, itemsWritten: rows.length, runId });
  } catch (err) {
    await db.update(radarRuns).set({ status: 'failed', finishedAt: now() }).where(eq(radarRuns.id, runId));
    return c.json({ error: { code: 'INGEST_FAILED', message: err instanceof Error ? err.message : 'ingest failed' } }, 500);
  }
});

// ───────────────────── Supplier-lookup cache + budget ───────────────────────
// The crawler's credit discipline lives here (server-authoritative), because a
// GitHub Actions runner can't reach D1 directly and keeps no reliable state.

async function monthUsage(db: ReturnType<typeof createDb>): Promise<number> {
  const [row] = await db.select().from(apifyUsage).where(eq(apifyUsage.monthKey, currentMonthKey()));
  return row?.resultsConsumed ?? 0;
}

const lookupSchema = z.object({
  keys: z.array(z.string().min(1)).max(500),
  ttlDays: z.number().positive().default(DEFAULT_CACHE_TTL_DAYS),
});

/**
 * Batch cache lookup. Returns only FRESH hits (checked within ttlDays) keyed by
 * normalizedKey → { match | null }. A present key with `match: null` means
 * "checked, no supplier found" (don't re-query). Absent keys are cache misses
 * the crawler must resolve (subject to the budget). Also returns this month's
 * Apify usage so the crawler can enforce its ceiling.
 */
app.post('/supplier/lookup', async (c) => {
  const parsed = lookupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
  const { keys, ttlDays } = parsed.data;
  if (keys.length === 0) return c.json({ hits: {}, monthUsage: 0 });

  const db = createDb(c.env.SOURCING_DB);
  const freshAfter = now() - ttlDays * DAY_MS;
  // Chunk the IN(...) so a large key set can't blow D1's 100-param cap.
  const rows: (typeof supplierCache.$inferSelect)[] = [];
  for (let i = 0; i < keys.length; i += LOOKUP_KEY_CHUNK) {
    const batch = keys.slice(i, i + LOOKUP_KEY_CHUNK);
    rows.push(...(await db.select().from(supplierCache).where(inArray(supplierCache.normalizedKey, batch))));
  }

  const hits: Record<string, { match: unknown | null }> = {};
  for (const row of rows) {
    if (row.lastChecked >= freshAfter) {
      hits[row.normalizedKey] = { match: row.matchJson ? JSON.parse(row.matchJson) : null };
    }
  }
  return c.json({ hits, monthUsage: await monthUsage(db) });
});

const storeSchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().min(1),
        match: z
          .object({
            productId: z.string(),
            url: z.string(),
            costCents: z.number().int().nonnegative(),
            rating: z.number().nullish(),
            orders: z.number().int().nonnegative().nullish(),
            imageUrl: z.string().nullish(),
          })
          .nullable(),
        resultsConsumed: z.number().int().nonnegative().default(0),
      }),
    )
    .max(500),
});

/**
 * Persists cache entries the crawler just resolved and increments this month's
 * Apify result counter by the total results consumed. Returns the new usage.
 */
app.post('/supplier/store', async (c) => {
  const parsed = storeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);
  const { entries } = parsed.data;

  const db = createDb(c.env.SOURCING_DB);
  const ts = now();
  let consumed = 0;
  for (const e of entries) {
    consumed += e.resultsConsumed;
    await db
      .insert(supplierCache)
      .values({
        normalizedKey: e.key,
        matchJson: e.match ? JSON.stringify(e.match) : null,
        sourceable: e.match ? 1 : 0,
        lastChecked: ts,
      })
      .onConflictDoUpdate({
        target: supplierCache.normalizedKey,
        set: { matchJson: e.match ? JSON.stringify(e.match) : null, sourceable: e.match ? 1 : 0, lastChecked: ts },
      });
  }

  // Increment via a SQL fragment (single nightly writer, so no real contention;
  // this just avoids a read-modify-write round trip).
  await db
    .insert(apifyUsage)
    .values({ monthKey: currentMonthKey(), resultsConsumed: consumed })
    .onConflictDoUpdate({ target: apifyUsage.monthKey, set: { resultsConsumed: sql`${apifyUsage.resultsConsumed} + ${consumed}` } });

  return c.json({ monthUsage: await monthUsage(db) });
});

export default app;
