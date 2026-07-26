import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import shopifyWebhook from './routes/webhooks.shopify.js';
import trackingWebhook from './routes/webhooks.tracking.js';
import ebayDeletionWebhook from './routes/webhooks.ebay-deletion.js';
import apiRoutes from './routes/api/index.js';
import oauthRoutes from './routes/oauth.js';
import { handleEmail } from './email.js';
import { handleQueue } from './queue.js';
import { handleScheduled } from './scheduled.js';

const app = new Hono<{ Bindings: Env }>();

// The dashboard calls /api/* same-origin (served by this same Worker), so it
// never needs this — but the Chrome extension's content scripts call it
// cross-origin from whatever marketplace page they're injected into
// (amazon.com, amazon.de, ebay.com, ...), and a content script's own fetch()
// is bound by the host page's CORS policy same as any page script (confirmed
// live: requests were reaching this Worker and being correctly authenticated,
// but the browser discarded the response before the extension ever saw it,
// since no Access-Control-Allow-Origin header was present). Allowing every
// origin here is safe specifically because every /api/* route already
// requires a valid bearer token via authMiddleware — an arbitrary origin
// gains nothing from being allowed to *ask*, since it still can't produce a
// token it was never given (tokens live only in chrome.storage.local, never
// exposed to page JS).
app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));

app.route('/webhooks/shopify', shopifyWebhook);
app.route('/webhooks/17track', trackingWebhook);
app.route('/webhooks/ebay-account-deletion', ebayDeletionWebhook);
app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api', apiRoutes);
app.route('/oauth', oauthRoutes);

// Static dashboard (Workers Assets) fallback for everything else.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export { OrderWorkflow } from './workflows/order.js';
export { DisputeWorkflow } from './workflows/dispute.js';

export default {
  fetch: app.fetch,
  email: handleEmail,
  queue: handleQueue,
  scheduled: handleScheduled,
};
