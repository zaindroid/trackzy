import { createDb, users } from '@fulfillment-tracker/db';
import type { Env } from './env.js';
import { pollGmailForUser } from './gmailIngestion.js';

// Keep in sync with wrangler.toml's `[triggers].crons`.
export const GMAIL_POLL_CRON = '*/5 * * * *';

/**
 * Single scheduled() entry point, dispatching on the triggering cron
 * expression — the same pattern later scheduled jobs (e.g. milestone 8's
 * hourly repricing sweep) will extend rather than adding a second `scheduled`
 * export, which Workers doesn't support.
 */
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  if (event.cron === GMAIL_POLL_CRON) {
    await pollGmailInboxes(env);
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
