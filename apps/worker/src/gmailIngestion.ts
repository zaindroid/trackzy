import { createDb, fulfillments, suppliers, users, webhookEvents, type Database } from '@fulfillment-tracker/db';
import { and, eq, isNull } from 'drizzle-orm';
import { detectCarrier } from '@fulfillment-tracker/core';
import { createGmailClient, type GmailClient } from '@fulfillment-tracker/adapters/gmail';
import type { Env } from './env.js';
import { newId, now } from './lib/id.js';
import { resolveSecretRef } from './lib/secretRef.js';
import { encryptCredential } from './lib/credentialCrypto.js';
import { extractTrackingCandidate } from './lib/extractTrackingCandidate.js';
import { notifyTrackingReceived } from './lib/notifyTrackingReceived.js';
import type { TrackingReceivedEvent } from './workflows/types.js';

/**
 * Matches subjects for the two ingestion paths spec 6b names explicitly
 * (Amazon Retail shipment confirmations, AliExpress shipping notifications)
 * plus generic shipping-confirmation language, so a supplier's own regex
 * parser (or the Gemini fallback) gets a chance at anything plausible.
 */
const GMAIL_SEARCH_QUERY = 'subject:(shipped OR shipping OR "has shipped" OR tracking OR dispatched)';

/**
 * Polls one user's connected Gmail inbox for new supplier shipping-
 * confirmation emails since their last poll, extracts tracking numbers
 * (regex first, Gemini fallback — spec 6b), and resolves them onto the
 * matching pending fulfillment exactly like the inbound-email path
 * (email.ts) does. This is scheduled work (see index.ts's `scheduled`
 * export + wrangler.toml's cron trigger), never invoked from a request path,
 * per the hard rule that slow work only happens in Workflows/scheduled
 * handlers.
 */
export async function pollGmailForUser(env: Env, userId: string): Promise<void> {
  const db = createDb(env.DB);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.gmailRefreshTokenRef || !user.gmailAccessTokenRef) {
    return; // no Gmail inbox connected for this user
  }

  const tokens = {
    accessToken: await resolveSecretRef(user.gmailAccessTokenRef, env),
    refreshToken: await resolveSecretRef(user.gmailRefreshTokenRef, env),
    expiresAt: user.gmailTokenExpiresAt ?? 0,
  };

  const gmail = createGmailClient(env, tokens, async (refreshed) => {
    // The refreshed access token is written back encrypted (see
    // credentialCrypto.ts/DECISIONS.md) into the same `*_ref` column —
    // `resolveSecretRef` already supports a ref column holding an `env:`
    // pointer, an `enc:`-encrypted value, or (legacy) a raw literal. This is
    // required, not cosmetic: a static `env:GMAIL_OAUTH_ACCESS_TOKEN` secret
    // never changes, but the *initial* access token it points at is only
    // valid for ~1 hour. Persisting only `gmailTokenExpiresAt` (as this used
    // to do) would make the next poll trust a stale/expired token as "still
    // fresh" — the timestamp would correctly describe the just-issued token,
    // but the column would still resolve to the original static one.
    await db
      .update(users)
      .set({ gmailAccessTokenRef: await encryptCredential(env, refreshed.accessToken), gmailTokenExpiresAt: refreshed.expiresAt })
      .where(eq(users.id, userId));
  });

  const since = user.gmailLastPolledAt ?? 0;
  const summaries = await gmail.listNewMessages(GMAIL_SEARCH_QUERY, since);
  const activeSuppliers = await db.select().from(suppliers).where(eq(suppliers.active, 1));

  for (const summary of summaries) {
    await processGmailMessage(db, env, gmail, summary.id, activeSuppliers);
  }

  await db.update(users).set({ gmailLastPolledAt: now() }).where(eq(users.id, userId));
}

async function processGmailMessage(
  db: Database,
  env: Env,
  gmail: GmailClient,
  messageId: string,
  activeSuppliers: (typeof suppliers.$inferSelect)[],
): Promise<void> {
  const [existing] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.source, 'email'), eq(webhookEvents.dedupKey, `gmail:${messageId}`)))
    .limit(1);
  if (existing) return; // already processed this exact message

  const message = await gmail.getMessage(messageId);
  const matchedSupplier = activeSuppliers.find((s) =>
    message.from.toLowerCase().includes(s.emailSenderPattern.toLowerCase()),
  );

  const { candidate, source, error: extractionError } = await extractTrackingCandidate({
    env,
    subject: message.subject,
    text: message.textBody,
    supplierName: matchedSupplier?.name,
    parserId: matchedSupplier?.parserId,
  });

  const recordEvent = (error: string | null) =>
    db.insert(webhookEvents).values({
      id: newId(),
      source: 'email',
      dedupKey: `gmail:${messageId}`,
      rawBody: message.textBody,
      headersJson: JSON.stringify({ from: message.from, subject: message.subject, gmailMessageId: messageId }),
      processed: 1,
      error,
      receivedAt: now(),
    });

  if (!candidate) {
    await recordEvent(extractionError);
    return;
  }
  if (!matchedSupplier) {
    await recordEvent('Extracted a tracking candidate but the sender did not match any registered supplier');
    return;
  }

  const detection = detectCarrier(candidate.trackingNumber, candidate.carrierDeclared ?? null);

  // Same FIFO-per-supplier heuristic as email.ts's inbound path (spec 6b
  // groups this Gmail pipeline with inbound email as one ingestion family) —
  // the oldest fulfillment for this supplier still awaiting tracking.
  const [fulfillment] = await db
    .select({ id: fulfillments.id, orderId: fulfillments.orderId })
    .from(fulfillments)
    .where(and(eq(fulfillments.supplierId, matchedSupplier.id), isNull(fulfillments.trackingNumber)))
    .orderBy(fulfillments.createdAt)
    .limit(1);

  if (!fulfillment) {
    await recordEvent(
      `Extracted tracking ${candidate.trackingNumber} for supplier '${matchedSupplier.name}' but no pending fulfillment is awaiting tracking`,
    );
    return;
  }

  await recordEvent(null);

  await db
    .update(fulfillments)
    .set({
      trackingNumber: candidate.trackingNumber,
      carrierDeclared: detection.carrierDeclared,
      carrierDetected: detection.carrierDetected,
      carrierFinal: detection.carrierFinal,
      trackingStatus: detection.needsReview ? 'needs_review' : 'pending',
      source,
      updatedAt: now(),
    })
    .where(eq(fulfillments.id, fulfillment.id));

  if (!detection.needsReview) {
    const event: TrackingReceivedEvent = {
      fulfillmentId: fulfillment.id,
      trackingNumber: candidate.trackingNumber,
      carrierDeclared: candidate.carrierDeclared,
      sku: candidate.sku,
      source,
    };
    await notifyTrackingReceived(env, db, fulfillment.id, fulfillment.orderId, event);
  }
}
