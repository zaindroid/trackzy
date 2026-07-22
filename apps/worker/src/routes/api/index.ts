import { Hono } from 'hono';
import type { Env } from '../../env.js';

// TODO(MILESTONE 7): authed JSON API for the dashboard (orders, fulfillments,
// suppliers, disputes, settings, metrics) per spec section 9.
const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.json({ ok: true }));

export default app;
