import { Hono } from 'hono';
import type { Env } from './env.js';
import shopifyWebhook from './routes/webhooks.shopify.js';
import trackingWebhook from './routes/webhooks.tracking.js';
import apiRoutes from './routes/api/index.js';
import oauthRoutes from './routes/oauth.js';
import { handleEmail } from './email.js';
import { handleQueue } from './queue.js';
import { handleScheduled } from './scheduled.js';

const app = new Hono<{ Bindings: Env }>();

app.route('/webhooks/shopify', shopifyWebhook);
app.route('/webhooks/17track', trackingWebhook);
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
