import type {
  OrderSource,
  OrderSourceListing,
  OrderSourceOrder,
  PushTrackingInput,
  UpdateListingInput,
} from '../orderSource/iface.js';
import { NonApiModeError } from './real.js';

const FIXTURE_ORDERS: OrderSourceOrder[] = [
  {
    externalOrderId: 'ebay-mock-16-11635-28233',
    externalOrderNumber: '16-11635-28233',
    currency: 'USD',
    subtotalCents: 5999,
    shippingCents: 0,
    lineItems: [
      { externalLineItemId: 'ebay-mock-li-1', sku: 'WIDGET-RED-L', title: 'Widget - Red / Large', quantity: 1, unitPriceCents: 5999 },
    ],
    buyerName: 'mock_buyer_1',
    shipTo: {
      name: 'Jordan Buyer',
      address1: '742 Evergreen Terrace',
      city: 'Springfield',
      state: 'IL',
      zip: '62704',
      country: 'US',
    },
  },
];

const FIXTURE_LISTINGS: OrderSourceListing[] = [
  { externalListingId: 'ebay-mock-listing-1', sku: 'WIDGET-RED-L', title: 'Widget - Red / Large', priceCents: 5999, quantityAvailable: 42 },
  { externalListingId: 'ebay-mock-listing-2', sku: 'GIZMO-GREEN-S', title: 'Gizmo (Green, Small)', priceCents: 7499, quantityAvailable: 15 },
];

export interface MockCall {
  method: 'pushTracking' | 'sendBuyerMessage' | 'updateListing' | 'pauseListing';
  args: unknown[];
}

/** Deterministic, fixture-backed eBay mock — no network, no OAuth. */
export class MockEbayOrderSource implements OrderSource {
  public readonly calls: MockCall[] = [];

  constructor(private readonly nonApiMode = false) {}

  async listNewOrders(since: number): Promise<OrderSourceOrder[]> {
    // Fixture orders are all "new" relative to any since <= 0; a since in the
    // far future returns nothing, giving tests a deterministic empty case.
    return since > Date.now() ? [] : FIXTURE_ORDERS;
  }

  async getOrder(externalOrderId: string): Promise<OrderSourceOrder | null> {
    return FIXTURE_ORDERS.find((o) => o.externalOrderId === externalOrderId) ?? null;
  }

  async pushTracking(externalOrderId: string, input: PushTrackingInput): Promise<void> {
    if (this.nonApiMode) {
      throw new NonApiModeError(externalOrderId, input);
    }
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
