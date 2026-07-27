import { Hono } from 'hono';
import type { Env } from '../../env.js';
import { authMiddleware, type AuthedVariables } from '../../middleware/auth.js';
import connections from './connections.js';
import settings from './settings.js';
import research from './research.js';
import candidates from './candidates.js';
import radar from './radar.js';
import credits from './credits.js';
import billing from './billing.js';
import library from './library.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

app.use('*', authMiddleware);
app.route('/connections', connections);
app.route('/settings', settings);
app.route('/product-research', research);
app.route('/candidates', candidates);
app.route('/radar', radar);
app.route('/credits', credits);
app.route('/billing', billing);
app.route('/library', library);

export default app;
