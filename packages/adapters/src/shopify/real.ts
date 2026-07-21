import type {
  CreateFulfillmentInput,
  CreateFulfillmentResult,
  FulfillmentOrderLookup,
  ShopifyClient,
  ShopifyEnv,
} from './iface.js';

const FULFILLMENT_ORDER_QUERY = `#graphql
  query OrderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 10) {
        edges {
          node {
            id
            lineItems(first: 100) {
              edges {
                node {
                  id
                  lineItem { id }
                }
              }
            }
          }
        }
      }
    }
  }
`;

const FULFILLMENT_CREATE_MUTATION = `#graphql
  mutation FulfillmentCreate($fulfillment: FulfillmentV2Input!) {
    fulfillmentCreateV2(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export class RealShopifyClient implements ShopifyClient {
  constructor(private readonly env: ShopifyEnv) {}

  private endpoint(shopDomain: string): string {
    const version = this.env.SHOPIFY_API_VERSION ?? '2024-10';
    return `https://${shopDomain}/admin/api/${version}/graphql.json`;
  }

  private async graphql<T>(shopDomain: string, query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.endpoint(shopDomain), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.env.SHOPIFY_ACCESS_TOKEN ?? '',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Shopify GraphQL request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as GraphQLResponse<T>;
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL errors: ${json.errors.map((e) => e.message).join('; ')}`);
    }
    if (!json.data) {
      throw new Error('Shopify GraphQL response missing data');
    }
    return json.data;
  }

  async getFulfillmentOrder(
    shopDomain: string,
    externalOrderId: string,
    lineItemExternalIds: string[],
  ): Promise<FulfillmentOrderLookup> {
    interface Data {
      order: {
        fulfillmentOrders: {
          edges: { node: { id: string; lineItems: { edges: { node: { id: string; lineItem: { id: string } } }[] } } }[];
        };
      } | null;
    }

    const data = await this.graphql<Data>(shopDomain, FULFILLMENT_ORDER_QUERY, { id: externalOrderId });
    const fulfillmentOrderEdge = data.order?.fulfillmentOrders.edges[0];
    if (!fulfillmentOrderEdge) {
      throw new Error(`No open fulfillment order found for Shopify order ${externalOrderId}`);
    }

    const lineItemMap: Record<string, string> = {};
    for (const edge of fulfillmentOrderEdge.node.lineItems.edges) {
      const externalLineItemId = edge.node.lineItem.id;
      if (lineItemExternalIds.includes(externalLineItemId)) {
        lineItemMap[externalLineItemId] = edge.node.id;
      }
    }

    return { fulfillmentOrderId: fulfillmentOrderEdge.node.id, lineItemMap };
  }

  async createFulfillment(
    shopDomain: string,
    input: CreateFulfillmentInput,
  ): Promise<CreateFulfillmentResult> {
    interface Data {
      fulfillmentCreateV2: {
        fulfillment: { id: string; status: string } | null;
        userErrors: { field: string[]; message: string }[];
      };
    }

    const data = await this.graphql<Data>(shopDomain, FULFILLMENT_CREATE_MUTATION, {
      fulfillment: {
        lineItemsByFulfillmentOrder: [
          {
            fulfillmentOrderId: input.fulfillmentOrderId,
            fulfillmentOrderLineItems: input.lineItems.map((li) => ({
              id: li.fulfillmentOrderLineItemId,
              quantity: li.quantity,
            })),
          },
        ],
        trackingInfo: {
          number: input.trackingNumber,
          company: input.trackingCompany,
        },
        notifyCustomer: input.notifyCustomer ?? true,
      },
    });

    if (data.fulfillmentCreateV2.userErrors.length > 0) {
      throw new Error(
        `Shopify fulfillmentCreateV2 errors: ${data.fulfillmentCreateV2.userErrors
          .map((e) => e.message)
          .join('; ')}`,
      );
    }
    if (!data.fulfillmentCreateV2.fulfillment) {
      throw new Error('Shopify fulfillmentCreateV2 returned no fulfillment');
    }

    return {
      fulfillmentId: data.fulfillmentCreateV2.fulfillment.id,
      status: data.fulfillmentCreateV2.fulfillment.status,
    };
  }
}
