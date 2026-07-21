import type {
  CreateSupplierOrderInput,
  CreateSupplierOrderResult,
  SupplierClient,
  SupplierPriceQuote,
} from './iface.js';

function hashSku(sku: string): number {
  let h = 0;
  for (let i = 0; i < sku.length; i++) {
    h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** Deterministic pricing + "ships 60s after order" simulation, per spec section 10. */
export class MockSupplierClient implements SupplierClient {
  private orderCounter = 0;

  async getPrice(_baseUrl: string, sku: string, quantity: number): Promise<SupplierPriceQuote> {
    const base = 1000 + (hashSku(sku) % 4000);
    return { sku, costCents: base * quantity };
  }

  async createOrder(
    _baseUrl: string,
    input: CreateSupplierOrderInput,
  ): Promise<CreateSupplierOrderResult> {
    this.orderCounter += 1;
    return {
      supplierOrderId: `mock-so-${this.orderCounter}-${input.externalOrderRef}`,
      estimatedShipAt: Date.now() + 60_000,
    };
  }
}
