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

export class MockAmazonBusinessClient implements SupplierApiClient {
  private orderCounter = 0;

  async searchProduct(query: string): Promise<SupplierProduct[]> {
    return [{ supplierProductId: `B0MOCK${(hashString(query) % 900000) + 100000}`, title: `${query} (Amazon Business)` }];
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    const base = 1500 + (hashString(supplierProductId) % 3500);
    return { costCents: base, shippingCents: 0, inStock: true, shipDays: 1.5 };
  }

  async createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult> {
    this.orderCounter += 1;
    return { supplierOrderRef: `mock-ab-order-${this.orderCounter}-${input.supplierProductId}` };
  }

  async getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult> {
    const digits = String(hashString(supplierOrderRef)).padStart(12, '0').slice(0, 12);
    return { trackingNumber: `TBA${digits}`, carrier: 'AMZL', status: 'in_transit' };
  }
}
