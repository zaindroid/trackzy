import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  createDb,
  listings,
  orderLineItems,
  orders,
  settings,
  storefronts,
  supplierOffers,
  type Database,
} from '@fulfillment-tracker/db';
import { evaluateMargin } from '@fulfillment-tracker/core';
import { createOrderSourceForStorefront } from './lib/orderSourceForStorefront.js';

import { placeSupplierOrder } from './lib/placeSupplierOrder.js';
import type { OrderSourceOrder } from '@fulfillment-tracker/adapters/orderSource';
import type { Env } from './env.js';
import { newId, now } from './lib/id.js';

/**
 * Polls every eBay/Amazon storefront for new orders and ingests them —
 * spec's Phase 2 marketplace pipeline had `OrderSource.listNewOrders()`
 * fully implemented (both marketplaces) but nothing ever called it. Shopify
 * doesn't need this: it pushes orders via webhook straight into
 * `OrderWorkflow` (apps/worker/src/routes/webhooks.shopify.ts). This is that
 * same ingestion job for the marketplaces that only offer polling, run on
 * its own cron (see scheduled.ts) rather than as a Cloudflare Workflow —
 * unlike Shopify's per-order workflow, there's no need for durable
 * step/retry semantics here: a failed poll or a failed single-order ingest
 * just gets retried on the next cron tick a few minutes later.
 */
export async function pollMarketplaceOrders(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const mpStorefronts = await db.select().from(storefronts).where(inArray(storefronts.platform, ['ebay', 'amazon']));

  for (const storefront of mpStorefronts) {
    const orderSource = await createOrderSourceForStorefront(env, db, storefront);
    if (!orderSource) continue; // no OAuth configured yet for this storefront

    // A never-polled storefront can't have any orders from before it was
    // connected — falling back to epoch 0 here (as this used to) sends
    // eBay's Fulfillment API a `creationdate` filter over 50 years in the
    // past, which it rejects outright ("Start date must be within '2' years
    // from present date"), and since that failure never advances
    // `lastPolledAt`, every brand-new storefront would fail this exact way
    // on every single poll forever (see DECISIONS.md).
    const since = storefront.lastPolledAt ?? storefront.createdAt;
    let sourceOrders: OrderSourceOrder[];
    try {
      sourceOrders = await orderSource.listNewOrders(since);
    } catch (err) {
      console.error(`[marketplaceSync] listNewOrders failed for storefront ${storefront.id}:`, err);
      continue; // don't advance lastPolledAt — retried in full next tick
    }

    for (const sourceOrder of sourceOrders) {
      await ingestMarketplaceOrder(db, env, storefront.id, storefront.userId, sourceOrder).catch((err) => {
        console.error(`[marketplaceSync] failed to ingest order ${sourceOrder.externalOrderId}:`, err);
      });
    }

    await db.update(storefronts).set({ lastPolledAt: now() }).where(eq(storefronts.id, storefront.id));
  }
}

interface SupplierMatch {
  supplierId: string;
  costCents: number;
  sku: string;
  quantity: number;
  title: string;
}

/**
 * Ingests one polled marketplace order: creates `orders`/`order_line_items`,
 * matches each line item's SKU to a supplier via the existing
 * `listings`/`supplier_offers` catalog-matching tables (milestone 8 — the
 * same tables the repricing sweep already maintains), evaluates margin
 * against the real per-SKU supplier cost, and — if it clears the
 * threshold — places one supplier order per matched supplier (grouping
 * multiple line items onto the same supplier into a single fulfillment,
 * same shape as the Shopify workflow's split-shipment handling).
 */
export async function ingestMarketplaceOrder(
  db: Database,
  env: Env,
  storefrontId: string,
  userId: string,
  sourceOrder: OrderSourceOrder,
): Promise<void> {
  const [existing] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.storefrontId, storefrontId), eq(orders.externalOrderId, sourceOrder.externalOrderId)))
    .limit(1);
  if (existing) return; // already ingested — listNewOrders(since) can overlap at the boundary

  const orderId = newId();
  await db.insert(orders).values({
    id: orderId,
    storefrontId,
    externalOrderId: sourceOrder.externalOrderId,
    externalOrderNumber: sourceOrder.externalOrderNumber,
    status: 'received',
    currency: sourceOrder.currency,
    subtotalCents: sourceOrder.subtotalCents,
    shippingCents: sourceOrder.shippingCents,
    marginCents: null,
    rawPayloadId: null,
    createdAt: now(),
    updatedAt: now(),
    // Persisted so the tracking-proxy step (trackingUploader.ts) can match
    // a TrackCaptain number by destination later — shipTo isn't otherwise
    // reachable by fulfillmentId once this function returns (see DECISIONS.md).
    shipToJson: sourceOrder.shipTo ? JSON.stringify(sourceOrder.shipTo) : null,
  });

  for (const li of sourceOrder.lineItems) {
    await db.insert(orderLineItems).values({
      id: newId(),
      orderId,
      externalLineItemId: li.externalLineItemId,
      fulfillmentOrderLineItemId: null,
      sku: li.sku,
      title: li.title,
      quantity: li.quantity,
      quantityFulfilled: 0,
      unitPriceCents: li.unitPriceCents,
    });
  }

  // Match every line item's SKU to the listing (this storefront's SKU ->
  // matched supplier + supplierProductId, see catalog/matchListing.ts) and
  // that listing's most recent cached supplier_offers cost. A line item
  // with no matched listing, or a matched listing with no cost data yet,
  // means we genuinely don't know what this costs to fulfill — the order
  // goes to 'exception' for a human to resolve rather than guessing.
  const matches: SupplierMatch[] = [];
  for (const li of sourceOrder.lineItems) {
    const [listing] = await db
      .select({ id: listings.id, supplierId: listings.supplierId })
      .from(listings)
      .where(and(eq(listings.storefrontId, storefrontId), eq(listings.sku, li.sku)))
      .limit(1);

    const [offer] = listing?.supplierId
      ? await db
          .select({ costCents: supplierOffers.costCents })
          .from(supplierOffers)
          .where(and(eq(supplierOffers.listingId, listing.id), eq(supplierOffers.supplierId, listing.supplierId)))
          .orderBy(desc(supplierOffers.checkedAt))
          .limit(1)
      : [];

    if (!listing?.supplierId || !offer) {
      await db.update(orders).set({ status: 'exception', updatedAt: now() }).where(eq(orders.id, orderId));
      return;
    }

    matches.push({ supplierId: listing.supplierId, costCents: offer.costCents * li.quantity, sku: li.sku, quantity: li.quantity, title: li.title });
  }

  const totalSupplierCostCents = matches.reduce((sum, m) => sum + m.costCents, 0);
  const [userSettings] = await db.select().from(settings).where(eq(settings.userId, userId));

  const margin = evaluateMargin({
    subtotalCents: sourceOrder.subtotalCents,
    shippingCents: sourceOrder.shippingCents,
    supplierCostCents: totalSupplierCostCents,
    minMarginCents: userSettings?.minMarginCents ?? 200,
    marginMode: userSettings?.marginMode ?? 'absolute',
    minMarginPercent: userSettings?.minMarginPercent ?? 10,
  });

  if (!margin.meetsThreshold) {
    await db
      .update(orders)
      .set({ marginCents: margin.marginCents, status: 'rejected', updatedAt: now() })
      .where(eq(orders.id, orderId));
    return;
  }

  await db
    .update(orders)
    .set({ marginCents: margin.marginCents, status: 'fulfilling', updatedAt: now() })
    .where(eq(orders.id, orderId));

  const bySupplier = new Map<string, SupplierMatch[]>();
  for (const m of matches) {
    const group = bySupplier.get(m.supplierId) ?? [];
    group.push(m);
    bySupplier.set(m.supplierId, group);
  }

  for (const [supplierId, group] of bySupplier) {
    const groupCostCents = group.reduce((sum, m) => sum + m.costCents, 0);
    await placeSupplierOrder(db, env, orderId, supplierId, groupCostCents, {
      shipTo: sourceOrder.shipTo,
      buyerName: sourceOrder.buyerName,
      lineItems: group.map((m) => ({ sku: m.sku, quantity: m.quantity, title: m.title })),
    });
  }
}
