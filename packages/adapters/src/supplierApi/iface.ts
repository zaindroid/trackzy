/**
 * Richer supplier-side interface for Phase 2's API-driven suppliers (Amazon
 * Business, AliExpress, CJ Dropshipping). Phase 1's `SupplierClient`
 * (packages/adapters/src/suppliers) stays untouched and keeps serving the
 * existing OrderWorkflow's generic-REST fulfillment path exactly as before —
 * this is a new, separate interface for the catalog-aware capabilities
 * (product search, scored offers, tracking lookup) those three new
 * suppliers need and Phase 1's simple getPrice/createOrder pair doesn't
 * cover. See DECISIONS.md.
 */
export interface SupplierApiShipTo {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface SupplierProduct {
  supplierProductId: string;
  title: string;
  sku?: string;
  /** Best-effort — lets a human visually verify a match is actually correct (see DECISIONS.md). Not every supplier maps one. */
  imageUrl?: string;
  /** A link to the actual product page on the supplier's own site — the fallback when there's no image (or even alongside one) to verify a match is correct. */
  productUrl?: string;
}

export interface SupplierOffer {
  costCents: number;
  shippingCents: number;
  inStock: boolean;
  shipDays?: number;
}

export interface CreateSupplierApiOrderInput {
  supplierProductId: string;
  quantity: number;
  shipTo: SupplierApiShipTo;
}

export interface CreateSupplierApiOrderResult {
  supplierOrderRef: string;
}

export interface SupplierTrackingResult {
  trackingNumber: string | null;
  carrier: string | null;
  status: string | null;
}

export interface SupplierApiClient {
  searchProduct(query: string): Promise<SupplierProduct[]>;
  getOffer(supplierProductId: string): Promise<SupplierOffer>;
  createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult>;
  getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult>;
}
