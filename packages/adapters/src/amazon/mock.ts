import type {
  OrderSource,
  OrderSourceListing,
  OrderSourceOrder,
  PushTrackingInput,
  UpdateListingInput,
} from '../orderSource/iface.js';

const FIXTURE_ORDERS: OrderSourceOrder[] = [
  {
    externalOrderId: '111-2223334-5556667',
    externalOrderNumber: '111-2223334-5556667',
    currency: 'USD',
    subtotalCents: 8999,
    shippingCents: 0,
    lineItems: [
      { externalLineItemId: 'amz-mock-li-1', sku: 'GADGET-BLUE-M', title: 'Gadget - Blue / Medium', quantity: 1, unitPriceCents: 8999 },
    ],
    shipTo: {
      name: 'Riley Customer',
      address1: '1600 Pennsylvania Ave NW',
      city: 'Washington',
      state: 'DC',
      zip: '20500',
      country: 'US',
    },
  },
];

const FIXTURE_LISTINGS: OrderSourceListing[] = [
  { externalListingId: 'GADGET-BLUE-M', sku: 'GADGET-BLUE-M', title: 'Gadget - Blue / Medium', priceCents: 8999, quantityAvailable: 20 },
];

export interface MockCall {
  method: 'pushTracking' | 'sendBuyerMessage' | 'updateListing' | 'pauseListing';
  args: unknown[];
}

/**
 * Deterministic, fixture-backed Amazon mock. `shipTo` is already populated on
 * the fixture (unlike the real adapter, which must fetch it via a
 * Restricted Data Token) — the mock exists to validate calling code's
 * behavior, not to re-simulate RDT plumbing that only the real adapter needs.
 */
export class MockAmazonOrderSource implements OrderSource {
  public readonly calls: MockCall[] = [];

  async listNewOrders(since: number): Promise<OrderSourceOrder[]> {
    return since > Date.now() ? [] : FIXTURE_ORDERS;
  }

  async getOrder(externalOrderId: string): Promise<OrderSourceOrder | null> {
    return FIXTURE_ORDERS.find((o) => o.externalOrderId === externalOrderId) ?? null;
  }

  async pushTracking(externalOrderId: string, input: PushTrackingInput): Promise<void> {
    this.calls.push({ method: 'pushTracking', args: [externalOrderId, input] });
  }

  async sendBuyerMessage(externalOrderId: string, body: string): Promise<void> {
    this.calls.push({ method: 'sendBuyerMessage', args: [externalOrderId, body] });
  }

  async listListings(): Promise<OrderSourceListing[]> {
    return FIXTURE_LISTINGS;
  }

  async updateListing(externalListingId: string, input: UpdateListingInput): Promise<void> {
    this.calls.push({ method: 'updateListing', args: [externalListingId, input] });
  }

  async pauseListing(externalListingId: string): Promise<void> {
    this.calls.push({ method: 'pauseListing', args: [externalListingId] });
  }
}
