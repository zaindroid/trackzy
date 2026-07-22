import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import type { WorkflowStep } from 'cloudflare:workers';
import {
  createDb,
  disputes,
  fulfillments,
  orders,
  storefronts,
  suppliers,
  users,
} from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { runDisputeWorkflow } from './disputeLogic.js';

function createFakeStep(): WorkflowStep {
  return {
    async do(_name: string, cbOrConfig: unknown, maybeCb?: unknown) {
      const callback = (typeof cbOrConfig === 'function' ? cbOrConfig : maybeCb) as (ctx: unknown) => Promise<unknown>;
      return callback({ step: { name: _name, count: 0 }, attempt: 1, config: {} });
    },
    sleep: async () => undefined,
    sleepUntil: async () => undefined,
    waitForEvent: async () => {
      throw new Error('not used in this test');
    },
  } as unknown as WorkflowStep;
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: 'usr_d', clerkUserId: 'dev-user', email: 'd@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: 'sf_d',
    userId: 'usr_d',
    platform: 'shopify',
    shopDomain: 'demo-store.myshopify.com',
    accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
    webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: 'sup_d',
    userId: 'usr_d',
    name: 'Acme Supply Co',
    apiBaseUrl: 'https://api.acmesupply.example.com',
    apiKeyRef: 'env:SUPPLIER_API_KEY',
    emailSenderPattern: '@acmesupply.example.com',
    parserId: 'acme-supply-v1',
    active: 1,
    createdAt: 0,
  });
  await db.insert(orders).values({
    id: 'ord_d',
    storefrontId: 'sf_d',
    externalOrderId: 'gid://shopify/Order/dispute-1',
    externalOrderNumber: '#9301',
    status: 'exception',
    currency: 'USD',
    subtotalCents: 9900,
    shippingCents: 650,
    marginCents: 3050,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(fulfillments).values({
    id: 'ff_d',
    orderId: 'ord_d',
    supplierId: 'sup_d',
    costCents: 6200,
    trackingNumber: '9200111899223197428499',
    carrierDeclared: null,
    carrierDetected: 'USPS',
    carrierFinal: null,
    trackingStatus: 'needs_review',
    pushedToStorefront: 0,
    source: 'gemini',
    createdAt: 0,
    updatedAt: 0,
  });
});

describe('runDisputeWorkflow', () => {
  it('drafts and persists a dispute email referencing the tracking number and reason', async () => {
    const step = createFakeStep();
    await runDisputeWorkflow({
      step,
      env: env as unknown as Parameters<typeof runDisputeWorkflow>[0]['env'],
      payload: { fulfillmentId: 'ff_d', reason: 'No scan update in 7 days' },
    });

    const db = createDb(env.DB);
    const [dispute] = await db.select().from(disputes).where(eq(disputes.fulfillmentId, 'ff_d'));
    expect(dispute).toBeDefined();
    expect(dispute?.status).toBe('draft');
    expect(dispute?.reason).toBe('No scan update in 7 days');
    expect(dispute?.draftSubject).toContain('9200111899223197428499');
    expect(dispute?.draftBody).toContain('No scan update in 7 days');
  });
});
