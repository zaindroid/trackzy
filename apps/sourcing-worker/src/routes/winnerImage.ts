import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, winners } from '@sourcing/db';
import type { Env } from '../env.js';

const app = new Hono<{ Bindings: Env }>();

// 1x1 transparent PNG fallback when the source can't be fetched.
const BLANK_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (ch) => ch.charCodeAt(0));

/**
 * Public TEASER image proxy for library/leaderboard cards. Serves a heavily
 * downscaled + blurred version of a winner's image THROUGH our origin, so the
 * raw supplier CDN URL (a reverse-search / bypass vector) never reaches the
 * client. Unauthenticated on purpose — <img> tags can't send a bearer token,
 * and it only ever serves the obscured teaser; the real, full-res image is
 * revealed post-unlock inside Research (from the unlock response), never here.
 *
 * Downscale/blur uses Cloudflare image resizing (`cf.image`); if the zone
 * doesn't support it the original is proxied instead (URL still hidden), and
 * the client additionally blurs — defense in depth. NOTE: pixel-level
 * un-reverse-searchable protection requires Cloudflare Images/resizing enabled;
 * see DECISIONS.
 */
app.get('/:id', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const [winner] = await db.select().from(winners).where(eq(winners.id, c.req.param('id')));
  const src = winner ? (JSON.parse(winner.imageUrlsJson) as string[])[0] : undefined;
  if (!src) return c.body(BLANK_PNG, 404, { 'Content-Type': 'image/png' });

  try {
    const res = await fetch(src, { cf: { image: { width: 56, blur: 120, quality: 40 } } } as RequestInit);
    if (!res.ok || !res.body) return c.body(BLANK_PNG, 200, { 'Content-Type': 'image/png' });
    return c.body(res.body, 200, {
      'Content-Type': res.headers.get('Content-Type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    });
  } catch {
    return c.body(BLANK_PNG, 200, { 'Content-Type': 'image/png' });
  }
});

export default app;
