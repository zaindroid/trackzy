import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env.js';
import apiRoutes from './routes/api/index.js';
import oauthRoutes from './routes/oauth.js';

const app = new Hono<{ Bindings: Env }>();

app.use('/api/*', cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));

app.get('/api/health', (c) => c.json({ ok: true }));
app.route('/api', apiRoutes);
app.route('/oauth', oauthRoutes);

// Static dashboard (Workers Assets) fallback for everything else.
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
