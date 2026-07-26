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

export class MockCjClient implements SupplierApiClient {
  private orderCounter = 0;

  async searchProduct(query: string): Promise<SupplierProduct[]> {
    const id = `CJ${(hashString(query) % 900000) + 100000}`;
    return [
      {
        supplierProductId: id,
        title: `${query} (CJ Dropshipping)`,
        imageUrl: `https://picsum.photos/seed/${id}/200/200`,
        productUrl: `https://www.cjdropshipping.com/product/-p-${id}.html`,
      },
    ];
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    const base = 1200 + (hashString(supplierProductId) % 2800);
    return { costCents: base, shippingCents: 150, inStock: true, shipDays: 7.2 };
  }

  async createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult> {
    this.orderCounter += 1;
    return { supplierOrderRef: `mock-cj-order-${this.orderCounter}-${input.supplierProductId}` };
  }

  async getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult> {
    const digits = String(hashString(supplierOrderRef)).padStart(10, '0').slice(0, 10);
    return { trackingNumber: `CJPKT${digits}`, carrier: 'CJPacket', status: 'in_transit' };
  }
}
