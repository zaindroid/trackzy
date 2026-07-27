import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import apiRoutes from './routes/api/index.js';
import oauthRoutes from './routes/oauth.js';
import ebayDeletionRoutes from './routes/webhooks.ebay-deletion.js';
import radarIngestRoutes from './routes/ingest.radar.js';
import lemonSqueezyWebhook from './routes/webhooks.lemonsqueezy.js';
import winnerImageRoutes from './routes/winnerImage.js';
import internalRoutes from './routes/internal.js';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api', apiRoutes);
app.route('/oauth', oauthRoutes);
// eBay Marketplace Account Deletion notification endpoint (unauthenticated —
// eBay calls it directly; GET challenge proves ownership, POST purges).
app.route('/webhooks/ebay-account-deletion', ebayDeletionRoutes);
// Product Radar ingest — the external crawler POSTs results here (bearer-token
// guarded via RADAR_INGEST_TOKEN, not Clerk; a CI job has no user session).
app.route('/ingest/radar', radarIngestRoutes);
// Lemon Squeezy billing webhook (unauthenticated — LS calls it; verified via
// X-Signature HMAC). Grants credits / updates subscriptions.
app.route('/webhooks/lemonsqueezy', lemonSqueezyWebhook);
// Public teaser-image proxy (blurred/downscaled) so raw supplier URLs never
// reach locked library/leaderboard cards. Unauthenticated by design (img tags).
app.route('/winner-image', winnerImageRoutes);
// Service-to-service (trackzy → sourcing) — token-guarded, no Clerk.
app.route('/internal', internalRoutes);

// Static dashboard (Workers Assets) fallback for everything else.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
