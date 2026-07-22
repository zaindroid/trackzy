import { createDb, users } from '@fulfillment-tracker/db';
import type { Env } from './env.js';
import { pollGmailForUser } from './gmailIngestion.js';
import { runRepricingSweep } from './catalog/repricingSweep.js';

// Keep in sync with wrangler.toml's `[triggers].crons`.
export const GMAIL_POLL_CRON = '*/5 * * * *';
export const REPRICING_SWEEP_CRON = '0 * * * *';

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
