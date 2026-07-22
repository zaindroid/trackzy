import { Hono } from 'hono';
import type { Env } from '../../env.js';
import { authMiddleware, type AuthedVariables } from '../../middleware/auth.js';
import orders from './orders.js';
import fulfillments from './fulfillments.js';
import suppliers from './suppliers.js';
import disputes from './disputes.js';
import settings from './settings.js';
import metrics from './metrics.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

// Every route in this sub-app requires a valid Clerk session. The public
// health check lives directly on the top-level app at GET /api/health,
// registered before this sub-app is mounted, so it never passes through here.
app.use('*', authMiddleware);
app.route('/orders', orders);
app.route('/fulfillments', fulfillments);
app.route('/suppliers', suppliers);
app.route('/disputes', disputes);
app.route('/settings', settings);
app.route('/metrics', metrics);

export default app;
