import {
  createDb,
  fulfillments,
  messageTemplates,
  messages,
  orderLineItems,
  orders,
  storefronts,
  type Database,
} from '@fulfillment-tracker/db';
import { and, eq } from 'drizzle-orm';
import type { Env } from './env.js';
import { newId, now } from './lib/id.js';
import { createOrderSourceForStorefront } from './lib/orderSourceForStorefront.js';

export type MessageTrigger = 'sold' | 'shipped' | 'delivered' | 'stalled' | 'feedback_reminder';

const DEFAULT_BODIES: Record<MessageTrigger, string> = {
  sold: "Thanks for your order! We're getting {{sku}} ready to ship.",
  shipped: 'Good news — your order is on the way! Tracking: {{trackingNumber}} ({{carrier}}).',
  delivered: 'Your order has been delivered. We hope you love it!',
  stalled: "We're following up on your shipment with the carrier and will update you shortly.",
  feedback_reminder: "If you have a moment, we'd really appreciate your feedback on your recent purchase.",
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => vars[key] ?? match);
}

/**
 * Buyer-messaging engine (spec "Buyer Engagement"): renders the user's
 * active template for the given trigger (falling back to a sensible default
 * if none is configured), sends it through the order's marketplace
 * `OrderSource`, and records a `messages` row regardless of outcome. Never
 * touches an LLM — message bodies are template substitution, not generation.
 */
export async function sendBuyerMessage(env: Env, orderId: string, trigger: MessageTrigger): Promise<void> {
  const db = createDb(env.DB);
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error(`Order ${orderId} not found`);

  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, order.storefrontId));
  if (!storefront) throw new Error(`Storefront ${order.storefrontId} not found`);

  const [template] = await db
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.userId, storefront.userId), eq(messageTemplates.trigger, trigger), eq(messageTemplates.active, 1)));

  const vars = await renderVars(db, orderId);
  const body = renderTemplate(template?.bodyTemplate ?? DEFAULT_BODIES[trigger], vars);

  const messageId = newId();
  const orderSource = await createOrderSourceForStorefront(env, db, storefront);

  if (!orderSource) {
    await db.insert(messages).values({
      id: messageId,
      orderId,
      trigger,
      templateId: template?.id ?? null,
      body,
      status: 'skipped', // e.g. Shopify — no marketplace buyer-messaging channel
      sentAt: null,
      createdAt: now(),
    });
    return;
  }

  try {
    await orderSource.sendBuyerMessage(order.externalOrderId, body);
    await db.insert(messages).values({
      id: messageId,
      orderId,
      trigger,
      templateId: template?.id ?? null,
      body,
      status: 'sent',
      sentAt: now(),
      createdAt: now(),
    });
  } catch {
    await db.insert(messages).values({
      id: messageId,
      orderId,
      trigger,
      templateId: template?.id ?? null,
      body,
      status: 'failed',
      sentAt: null,
      createdAt: now(),
    });
  }
}

async function renderVars(db: Database, orderId: string): Promise<Record<string, string>> {
  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.orderId, orderId));
  return {
    sku: lineItems[0]?.sku ?? '',
    trackingNumber: fulfillment?.trackingNumber ?? '',
    carrier: fulfillment?.carrierFinal ?? '',
  };
}

/**
 * Sends any `feedback_reminder` messages that are still `pending` and were
 * created more than `minAgeMs` ago (the "reminder" is deliberately a
 * follow-up, not instant — spec: "plus automated feedback reminders"). Run
 * from the same hourly cron as the repricing sweep (see scheduled.ts).
 */
export async function processPendingFeedbackReminders(env: Env, minAgeMs = 3 * 24 * 60 * 60 * 1000): Promise<void> {
  const db = createDb(env.DB);
  const pending = await db
    .select()
    .from(messages)
    .where(and(eq(messages.trigger, 'feedback_reminder'), eq(messages.status, 'pending')));

  const cutoff = now() - minAgeMs;
  for (const message of pending) {
    if (message.createdAt > cutoff) continue;

    const [order] = await db.select().from(orders).where(eq(orders.id, message.orderId));
    if (!order) continue;
    const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, order.storefrontId));
    if (!storefront) continue;

    const orderSource = await createOrderSourceForStorefront(env, db, storefront);
    if (!orderSource) {
      await db.update(messages).set({ status: 'skipped' }).where(eq(messages.id, message.id));
      continue;
    }

    try {
      await orderSource.sendBuyerMessage(order.externalOrderId, message.body);
      await db.update(messages).set({ status: 'sent', sentAt: now() }).where(eq(messages.id, message.id));
    } catch {
      await db.update(messages).set({ status: 'failed' }).where(eq(messages.id, message.id));
    }
  }
}

/** Schedules a feedback_reminder to be sent later by processPendingFeedbackReminders, rather than immediately. */
export async function scheduleFeedbackReminder(env: Env, orderId: string): Promise<void> {
  const db = createDb(env.DB);
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return;
  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, order.storefrontId));
  if (!storefront) return;

  const [template] = await db
    .select()
    .from(messageTemplates)
    .where(
      and(eq(messageTemplates.userId, storefront.userId), eq(messageTemplates.trigger, 'feedback_reminder'), eq(messageTemplates.active, 1)),
    );
  const vars = await renderVars(db, orderId);
  const body = renderTemplate(template?.bodyTemplate ?? DEFAULT_BODIES.feedback_reminder, vars);

  await db.insert(messages).values({
    id: newId(),
    orderId,
    trigger: 'feedback_reminder',
    templateId: template?.id ?? null,
    body,
    status: 'pending',
    sentAt: null,
    createdAt: now(),
  });
}
