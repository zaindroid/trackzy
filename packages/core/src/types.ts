export type Carrier = 'UPS' | 'USPS' | 'FEDEX' | 'DHL';

export type OrderStatus =
  | 'received'
  | 'evaluating'
  | 'fulfilling'
  | 'partially_shipped'
  | 'shipped'
  | 'delivered'
  | 'exception'
  | 'rejected'
  | 'cancelled';

export type FulfillmentSource = 'regex' | 'gemini' | 'manual' | 'supplier_api';

export type TrackingStatus =
  | 'pending'
  | 'in_transit'
  | 'delivered'
  | 'exception'
  | 'needs_review';

export type MarginMode = 'absolute' | 'percent';

export type DisputeStatus = 'draft' | 'approved' | 'sent' | 'resolved' | 'rejected';

export interface Money {
  /** Integer cents. Never use floats for money. */
  cents: number;
  currency: string;
}

export interface OrderLineItemInput {
  externalLineItemId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
}

export interface TrackingCandidate {
  trackingNumber: string;
  carrierDeclared?: Carrier;
  externalOrderRef?: string;
  sku?: string;
  /** 0..1 confidence, required for LLM-sourced candidates */
  confidence?: number;
}

export interface CarrierValidationResult {
  valid: boolean;
  /** True when checksum could not be verified because the carrier publishes none (e.g. FedEx). */
  weak: boolean;
}

export interface CarrierDetectionResult {
  carrierDeclared: Carrier | null;
  carrierDetected: Carrier | null;
  carrierFinal: Carrier | null;
  ambiguous: boolean;
  /** Format matched but the carrier publishes no checksum (FedEx, DHL eCommerce) — lower confidence. */
  weak: boolean;
  /** True when carrier_final could not be established and a human/17TRACK must resolve it. */
  needsReview: boolean;
}

export interface MarginSettings {
  minMarginCents: number;
  marginMode: MarginMode;
  minMarginPercent: number;
}

export interface MarginInput extends MarginSettings {
  subtotalCents: number;
  shippingCents: number;
  supplierCostCents: number;
}

export interface MarginResult {
  marginCents: number;
  marginPercent: number;
  meetsThreshold: boolean;
}
