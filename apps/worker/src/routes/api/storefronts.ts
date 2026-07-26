import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, storefronts } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';

/**
 * Read-only — storefronts are created exclusively through the OAuth connect
 * flow (routes/oauth.ts's `/ebay/callback`), never through a POST here.
 * Exists so the dashboard's Connections page can show whether the user's
 * eBay account is connected, and its non-API-mode status.
 */
const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const rows = await db
    .select({
      id: storefronts.id,
      platform: storefronts.platform,
      shopDomain: storefronts.shopDomain,
      nonApiMode: storefronts.nonApiMode,
      createdAt: storefronts.createdAt,
    })
    .from(storefronts)
    .where(eq(storefronts.userId, c.get('userId')));
  return c.json({ storefronts: rows });
});

export default app;
