import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb, settings } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const patchSchema = z.object({
  minMarginCents: z.number().int().min(0).optional(),
  marginMode: z.enum(['absolute', 'percent']).optional(),
  minMarginPercent: z.number().min(0).max(100).optional(),
  autoFulfill: z.boolean().optional(),
});

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const [row] = await db.select().from(settings).where(eq(settings.userId, c.get('userId')));
  if (!row) {
    return c.json({
      settings: { userId: c.get('userId'), minMarginCents: 200, marginMode: 'absolute', minMarginPercent: 10, autoFulfill: 1 },
    });
  }
  return c.json({ settings: row });
});

app.patch('/', async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const userId = c.get('userId');
  const [existing] = await db.select().from(settings).where(eq(settings.userId, userId));

  const patch = {
    ...(parsed.data.minMarginCents !== undefined && { minMarginCents: parsed.data.minMarginCents }),
    ...(parsed.data.marginMode !== undefined && { marginMode: parsed.data.marginMode }),
    ...(parsed.data.minMarginPercent !== undefined && { minMarginPercent: parsed.data.minMarginPercent }),
    ...(parsed.data.autoFulfill !== undefined && { autoFulfill: parsed.data.autoFulfill ? 1 : 0 }),
  };

  if (existing) {
    await db.update(settings).set(patch).where(eq(settings.userId, userId));
  } else {
    await db.insert(settings).values({
      userId,
      minMarginCents: patch.minMarginCents ?? 200,
      marginMode: patch.marginMode ?? 'absolute',
      minMarginPercent: patch.minMarginPercent ?? 10,
      autoFulfill: patch.autoFulfill ?? 1,
    });
  }

  return c.json({ ok: true });
});

export default app;
