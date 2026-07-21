export interface ShopifyEnv {
  MOCK_MODE?: string;
  SHOPIFY_ACCESS_TOKEN?: string;
  SHOPIFY_API_VERSION?: string;
}

export interface FulfillmentOrderLookup {
  fulfillmentOrderId: string;
  /** externalLineItemId -> fulfillmentOrderLineItemId */
  lineItemMap: Record<string, string>;
}

export interface CreateFulfillmentLineItem {
  fulfillmentOrderLineItemId: string;
  quantity: number;
}

export interface CreateFulfillmentInput {
  fulfillmentOrderId: string;
  trackingNumber: string;
  trackingCompany: string;
  lineItems: CreateFulfillmentLineItem[];
  notifyCustomer?: boolean;
}

export interface CreateFulfillmentResult {
  fulfillmentId: string;
  status: string;
}

export interface ShopifyClient {
  getFulfillmentOrder(
    shopDomain: string,
    externalOrderId: string,
    lineItemExternalIds: string[],
  ): Promise<FulfillmentOrderLookup>;

  createFulfillment(shopDomain: string, input: CreateFulfillmentInput): Promise<CreateFulfillmentResult>;
}
