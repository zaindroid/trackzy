import type {
  CreateFulfillmentInput,
  CreateFulfillmentResult,
  FulfillmentOrderLookup,
  ShopifyClient,
} from './iface.js';

/**
 * Fixture-backed mock: deterministically derives fulfillment-order-line-item
 * ids from the Shopify line item gids it's given, so tests and the local
 * demo flow never need a real Shopify store.
 */
export class MockShopifyClient implements ShopifyClient {
  public readonly createdFulfillments: CreateFulfillmentInput[] = [];
  private fulfillmentCounter = 0;

  async getFulfillmentOrder(
    _shopDomain: string,
    externalOrderId: string,
    lineItemExternalIds: string[],
  ): Promise<FulfillmentOrderLookup> {
    const orderNumeric = externalOrderId.split('/').pop() ?? externalOrderId;
    const lineItemMap: Record<string, string> = {};
    for (const externalLineItemId of lineItemExternalIds) {
      const lineItemNumeric = externalLineItemId.split('/').pop() ?? externalLineItemId;
      lineItemMap[externalLineItemId] = `gid://shopify/FulfillmentOrderLineItem/${lineItemNumeric}`;
    }
    return {
      fulfillmentOrderId: `gid://shopify/FulfillmentOrder/${orderNumeric}`,
      lineItemMap,
    };
  }

  async createFulfillment(
    _shopDomain: string,
    input: CreateFulfillmentInput,
  ): Promise<CreateFulfillmentResult> {
    this.createdFulfillments.push(input);
    this.fulfillmentCounter += 1;
    return {
      fulfillmentId: `gid://shopify/Fulfillment/mock-${this.fulfillmentCounter}`,
      status: 'success',
    };
  }
}
