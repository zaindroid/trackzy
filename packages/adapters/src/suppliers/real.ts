import type {
  CreateSupplierOrderInput,
  CreateSupplierOrderResult,
  SupplierClient,
  SupplierEnv,
  SupplierPriceQuote,
} from './iface.js';

/** Generic REST client that works against any supplier exposing GET /price and POST /orders. */
export class GenericRestSupplierClient implements SupplierClient {
  constructor(private readonly env: SupplierEnv) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.env.SUPPLIER_API_KEY ?? ''}`,
      'Content-Type': 'application/json',
    };
  }

  async getPrice(baseUrl: string, sku: string, quantity: number): Promise<SupplierPriceQuote> {
    const url = new URL('/price', baseUrl);
    url.searchParams.set('sku', sku);
    url.searchParams.set('quantity', String(quantity));
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) {
      throw new Error(`Supplier price lookup failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as SupplierPriceQuote;
  }

  async createOrder(baseUrl: string, input: CreateSupplierOrderInput): Promise<CreateSupplierOrderResult> {
    const res = await fetch(new URL('/orders', baseUrl), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(`Supplier order creation failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as CreateSupplierOrderResult;
  }
}
