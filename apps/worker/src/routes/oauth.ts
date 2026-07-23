import { Hono } from 'hono';
import type { Env } from '../env.js';

/**
 * Generic OAuth redirect landing pages for manual, one-time authorization
 * flows (AliExpress, and any future provider that needs a real callback
 * URL). These exist purely so the browser lands on an actual server
 * response instead of falling through to the SPA's `app.all('*', ...)`
 * Assets fallback (index.ts) — the dashboard's client-side router redirects
 * unrecognized paths away before a human can copy the `code` query param
 * from the address bar. No token exchange happens here; that's done
 * out-of-band once the code is copied from this page, consistent with how
 * every other OAuth setup step in this project is handled.
 */
const app = new Hono<{ Bindings: Env }>();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

app.get('/aliexpress/callback', (c) => {
  const code = c.req.query('code');
  return c.html(
    `<!doctype html><html><body style="font-family: monospace; padding: 2rem;">
      <h2>AliExpress authorization</h2>
      ${code ? `<p>Copy this code:</p><pre style="background:#eee;padding:1rem;word-break:break-all;">${escapeHtml(code)}</pre>` : '<p>No code present in the URL.</p>'}
    </body></html>`,
  );
});

export default app;
