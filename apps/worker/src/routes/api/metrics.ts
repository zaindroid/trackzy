import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, fulfillments, orders, storefronts } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const sfRows = await db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.userId, c.get('userId')));
  const sfIds = sfRows.map((r) => r.id);

  if (sfIds.length === 0) {
    return c.json({
      ordersToday: 0,
      avgMarginCents: 0,
      autoExtractedRegexPercent: 0,
      autoExtractedGeminiPercent: 0,
      exceptionsOpen: 0,
    });
  }

  const allOrders = await db.select().from(orders).where(inArray(orders.storefrontId, sfIds));
  const orderIds = allOrders.map((o) => o.id);
  const allFulfillments = orderIds.length
    ? await db.select().from(fulfillments).where(inArray(fulfillments.orderId, orderIds))
    : [];

  const startOfToday = Math.floor(Date.now() / ONE_DAY_MS) * ONE_DAY_MS;
  const ordersToday = allOrders.filter((o) => o.createdAt >= startOfToday).length;

  const marginValues = allOrders.map((o) => o.marginCents).filter((v): v is number => v !== null);
  const avgMarginCents = marginValues.length
    ? Math.round(marginValues.reduce((sum, v) => sum + v, 0) / marginValues.length)
    : 0;

  const extracted = allFulfillments.filter((f) => f.source === 'regex' || f.source === 'gemini');
  const regexCount = extracted.filter((f) => f.source === 'regex').length;
  const geminiCount = extracted.filter((f) => f.source === 'gemini').length;
  const autoExtractedRegexPercent = extracted.length ? Math.round((regexCount / extracted.length) * 100) : 0;
  const autoExtractedGeminiPercent = extracted.length ? Math.round((geminiCount / extracted.length) * 100) : 0;

  const exceptionsOpen = allOrders.filter((o) => o.status === 'exception').length;

  return c.json({
    ordersToday,
    avgMarginCents,
    autoExtractedRegexPercent,
    autoExtractedGeminiPercent,
    exceptionsOpen,
  });
});

export default app;
