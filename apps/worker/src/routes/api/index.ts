import { Hono } from 'hono';
import type { Env } from '../../env.js';
import { authMiddleware, type AuthedVariables } from '../../middleware/auth.js';
import orders from './orders.js';
import fulfillments from './fulfillments.js';
import suppliers from './suppliers.js';
import disputes from './disputes.js';
import settings from './settings.js';
import metrics from './metrics.js';
import manualTasks from './manualTasks.js';
import extension from './extension.js';
import listings from './listings.js';
import connections from './connections.js';
import storefronts from './storefronts.js';
import pendingSupplierOrders from './pendingSupplierOrders.js';
import productOpportunities from './productOpportunities.js';

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
app.route('/manual-tasks', manualTasks);
app.route('/extension', extension);
app.route('/listings', listings);
app.route('/connections', connections);
app.route('/storefronts', storefronts);
app.route('/pending-supplier-orders', pendingSupplierOrders);
app.route('/product-opportunities', productOpportunities);

export default app;
