import type {
  CreateSupplierApiOrderInput,
  CreateSupplierApiOrderResult,
  SupplierApiClient,
  SupplierOffer,
  SupplierProduct,
  SupplierTrackingResult,
} from '../iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** AliExpress has slower, less certain shipping than domestic suppliers — reflected in the mock's cost/timing. */
export class MockAliExpressClient implements SupplierApiClient {
  private orderCounter = 0;

  async searchProduct(query: string): Promise<SupplierProduct[]> {
    return [{ supplierProductId: `AE${(hashString(query) % 90000000) + 10000000}`, title: `${query} (AliExpress)` }];
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    const base = 800 + (hashString(supplierProductId) % 2500);
    return { costCents: base, shippingCents: 200, inStock: hashString(supplierProductId) % 10 !== 0, shipDays: 12.5 };
  }

  async createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult> {
    this.orderCounter += 1;
    return { supplierOrderRef: `mock-ae-order-${this.orderCounter}-${input.supplierProductId}` };
  }

  async getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult> {
    const digits = String(hashString(supplierOrderRef)).padStart(13, '0').slice(0, 13);
    return { trackingNumber: `LP${digits}CN`, carrier: 'CAINIAO', status: 'in_transit' };
  }
}
