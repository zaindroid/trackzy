export interface SupplierEnv {
  MOCK_MODE?: string;
  SUPPLIER_API_KEY?: string;
}

export interface SupplierLineItem {
  sku: string;
  quantity: number;
}

export interface SupplierPriceQuote {
  sku: string;
  costCents: number;
}

export interface CreateSupplierOrderInput {
  externalOrderRef: string;
  lineItems: SupplierLineItem[];
}

export interface CreateSupplierOrderResult {
  supplierOrderId: string;
  estimatedShipAt?: number;
}

export interface SupplierClient {
  getPrice(baseUrl: string, sku: string, quantity: number): Promise<SupplierPriceQuote>;
  createOrder(baseUrl: string, input: CreateSupplierOrderInput): Promise<CreateSupplierOrderResult>;
}
