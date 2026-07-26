import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb, sellerSettings } from '@sourcing/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

async function getOrCreate(db: ReturnType<typeof createDb>, userId: string) {
  const [existing] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
  if (existing) return existing;
  await db.insert(sellerSettings).values({ userId, updatedAt: now() });
  const [created] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
  return created!;
}

app.get('/', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  return c.json({ settings: await getOrCreate(db, c.get('userId')) });
});

const updateSchema = z.object({
  defaultShippingCostCents: z.number().int().min(0).optional(),
  handlingTimeDays: z.number().int().min(0).max(30).optional(),
  returnPolicy: z.enum(['no_returns', '30_day', '60_day']).optional(),
  targetMarginPercent: z.number().min(0).max(100).optional(),
  ebayFeePercent: z.number().min(0).max(100).optional(),
  itemLocationPostalCode: z.string().min(1).optional(),
});

app.put('/', async (c) => {
  const parsed = updateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);

  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  await getOrCreate(db, userId);
  await db
    .update(sellerSettings)
    .set({ ...parsed.data, updatedAt: now() })
    .where(eq(sellerSettings.userId, userId));
  const [updated] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId));
  return c.json({ settings: updated });
});

export default app;
