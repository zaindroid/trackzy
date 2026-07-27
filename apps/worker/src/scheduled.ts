import { createDb, suppliers, users, type Database } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { refreshAliExpressSessionIfStale, type AliExpressTokenSet } from '@fulfillment-tracker/adapters/supplierApi';
import type { Env } from './env.js';
import { pollGmailForUser } from './gmailIngestion.js';
import { runRepricingSweep } from './catalog/repricingSweep.js';
import { pollMarketplaceOrders } from './marketplaceSync.js';
import { syncAllListings } from './catalog/listingsSync.js';
import { resolveSecretRef } from './lib/secretRef.js';
import { encryptCredential } from './lib/credentialCrypto.js';

// Keep in sync with wrangler.toml's `[triggers].crons`.
export const GMAIL_POLL_CRON = '*/5 * * * *';
export const REPRICING_SWEEP_CRON = '0 * * * *';
export const MARKETPLACE_POLL_CRON = '*/10 * * * *';
export const ALIEXPRESS_KEEPALIVE_CRON = '0 */12 * * *';
// Deliberately much tighter than MARKETPLACE_POLL_CRON — a customer who just
// created a new eBay listing (or just connected a supplier that can now
// auto-match an existing one) shouldn't have to wait up to 10 minutes to see
// it land, see DECISIONS.md. Kept as its own cron rather than folded back
// into pollMarketplaceOrders so order polling's cadence stays independent.
export const LISTINGS_SYNC_CRON = '*/2 * * * *';

// Wide margin, deliberately much larger than RealAliExpressClient's own
// 5-minute just-in-time refresh margin — this cron may only run every 12h,
// and needs to catch a connection with zero real order/price activity in
// between (see refreshAliExpressSessionIfStale's doc comment and DECISIONS.md).
const ALIEXPRESS_KEEPALIVE_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * Single scheduled() entry point, dispatching on the triggering cron
 * expression — Workers only allows one `scheduled` export per Worker, so
 * every scheduled job shares this one dispatcher rather than each getting
 * its own entry point.
 */
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  if (event.cron === GMAIL_POLL_CRON) {
    await pollGmailInboxes(env);
  } else if (event.cron === REPRICING_SWEEP_CRON) {
    await runRepricingSweep(env);
  } else if (event.cron === MARKETPLACE_POLL_CRON) {
    await pollMarketplaceOrders(env);
    // Piggybacks the Zearch price/stock monitor sweep on this existing cron tick
    // — the account is already at Cloudflare's 5-cron-trigger limit, so the
    // sourcing worker has no cron of its own. Best-effort/non-blocking: the
    // sweep endpoint self-paces (only processes listings actually due), so
    // being pinged every 10 min is cheap, and any failure here must never
    // affect trackzy's own order polling above.
    await triggerSourcingMonitorSweep(env);
  } else if (event.cron === LISTINGS_SYNC_CRON) {
    await syncAllListings(env);
  } else if (event.cron === ALIEXPRESS_KEEPALIVE_CRON) {
    await keepAliExpressSessionsFresh(env);
  }
}

async function pollGmailInboxes(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const connectedUsers = await db
    .select({ id: users.id, gmailRefreshTokenRef: users.gmailRefreshTokenRef })
    .from(users);

  for (const user of connectedUsers) {
    if (!user.gmailRefreshTokenRef) continue;
    await pollGmailForUser(env, user.id);
  }
}

async function keepAliExpressSessionsFresh(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const aliexpressSuppliers = await db.select().from(suppliers).where(eq(suppliers.provider, 'aliexpress'));

  for (const supplier of aliexpressSuppliers) {
    if (!supplier.oauthAccessTokenRef || !supplier.oauthRefreshTokenRef) continue; // never actually connected
    try {
      await refreshOneSupplierIfStale(env, db, supplier);
    } catch (err) {
      // Best-effort per supplier — one connection's refresh token having
      // finally lapsed (the ~2-day ceiling — see DECISIONS.md) shouldn't stop
      // every other customer's keepalive from running this cycle.
      console.error(`[aliexpressKeepalive] failed to refresh supplier ${supplier.id}:`, err);
    }
  }
}

async function refreshOneSupplierIfStale(env: Env, db: Database, supplier: typeof suppliers.$inferSelect): Promise<void> {
  const tokens: AliExpressTokenSet = {
    accessToken: await resolveSecretRef(supplier.oauthAccessTokenRef!, env),
    refreshToken: await resolveSecretRef(supplier.oauthRefreshTokenRef!, env),
    expiresAt: supplier.oauthExpiresAt ?? 0,
  };
  await refreshAliExpressSessionIfStale(
    env,
    tokens,
    async (refreshed) => {
      await db
        .update(suppliers)
        .set({
          oauthAccessTokenRef: await encryptCredential(env, refreshed.accessToken),
          oauthRefreshTokenRef: await encryptCredential(env, refreshed.refreshToken),
          oauthExpiresAt: refreshed.expiresAt,
        })
        .where(eq(suppliers.id, supplier.id));
    },
    ALIEXPRESS_KEEPALIVE_MARGIN_MS,
  );
}

/** See the comment at the MARKETPLACE_POLL_CRON dispatch above. Dormant unless
 * both env vars are set; every failure is swallowed. */
async function triggerSourcingMonitorSweep(env: Env): Promise<void> {
  if (!env.SOURCING_BASE_URL || !env.INTERNAL_SERVICE_TOKEN) return;
  try {
    await fetch(`${env.SOURCING_BASE_URL}/internal/monitor-sweep`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}` },
    });
  } catch (err) {
    console.error('[triggerSourcingMonitorSweep] non-fatal:', err);
  }
}
