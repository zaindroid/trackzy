import PostalMime from 'postal-mime';
import { createDb, fulfillments, suppliers, webhookEvents } from '@fulfillment-tracker/db';
import { and, eq, isNull } from 'drizzle-orm';
import { detectCarrier } from '@fulfillment-tracker/core';
import type { Env } from './env.js';
import { newId, now } from './lib/id.js';
import { safeGetWorkflowInstance } from './lib/workflow.js';
import { extractTrackingCandidate } from './lib/extractTrackingCandidate.js';
import type { TrackingReceivedEvent } from './workflows/types.js';

/**
 * Cloudflare Email Routing entry point for inbound supplier shipment emails
 * (spec section 6b). Parses the raw MIME message, matches the sender against
 * a registered supplier, tries the supplier's regex parser first, falls back
 * to Gemini only when the parser fails or its confidence is low, validates
 * the resulting tracking number through the carrier detection chain, and
 * either notifies the order's OrderWorkflow instance or records the failure
 * for the dashboard's "Needs review" list.
 */
export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const rawBytes = await streamToArrayBuffer(message.raw);
  const parsed = await PostalMime.parse(rawBytes);
  const messageId = parsed.messageId || `no-message-id-${crypto.randomUUID()}`;
  const text = parsed.text ?? '';
  const subject = parsed.subject ?? '';
  const fromAddress = parsed.from?.address ?? message.from;
  const rawBody = new TextDecoder().decode(rawBytes);

  const db = createDb(env.DB);

  const [existing] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.source, 'email'), eq(webhookEvents.dedupKey, messageId)))
    .limit(1);
  if (existing) {
    return; // already processed this exact message
  }

  const activeSuppliers = await db.select().from(suppliers).where(eq(suppliers.active, 1));
  const matchedSupplier = activeSuppliers.find((s) =>
    fromAddress.toLowerCase().includes(s.emailSenderPattern.toLowerCase()),
  );

  const { candidate, source, error: extractionError } = await extractTrackingCandidate({
    env,
    subject,
    text,
    supplierName: matchedSupplier?.name,
    parserId: matchedSupplier?.parserId,
  });

  const recordEvent = (error: string | null) =>
    db.insert(webhookEvents).values({
      id: newId(),
      source: 'email',
      dedupKey: messageId,
      rawBody,
      headersJson: JSON.stringify({ from: fromAddress, subject }),
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

  // Match to the oldest fulfillment shell row for this supplier that's still
  // awaiting a tracking number (created by the OrderWorkflow's
  // place-supplier-order step). This is a FIFO heuristic appropriate for a
  // single-tenant demo; a multi-warehouse production system would instead
  // correlate via the supplier's own order id captured at order-placement time.
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
    const instance = await safeGetWorkflowInstance(env.ORDER_WORKFLOW, fulfillment.orderId);
    const event: TrackingReceivedEvent = {
      fulfillmentId: fulfillment.id,
      trackingNumber: candidate.trackingNumber,
      carrierDeclared: candidate.carrierDeclared,
      sku: candidate.sku,
      source,
    };
    await instance?.sendEvent({ type: 'tracking-received', payload: event });
  }
}

async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result.buffer;
}
