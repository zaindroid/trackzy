export interface Order {
  id: string;
  storefrontId: string;
  externalOrderId: string;
  externalOrderNumber: string;
  status: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  marginCents: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface OrderLineItem {
  id: string;
  orderId: string;
  sku: string;
  title: string;
  quantity: number;
  quantityFulfilled: number;
  unitPriceCents: number;
}

export interface Fulfillment {
  id: string;
  orderId: string;
  supplierId: string;
  costCents: number | null;
  trackingNumber: string | null;
  carrierDeclared: string | null;
  carrierDetected: string | null;
  carrierFinal: string | null;
  trackingStatus: string;
  pushedToStorefront: number;
  source: string;
  createdAt: number;
  updatedAt: number;
  lineItems?: { id: string; orderLineItemId: string; quantity: number }[];
}

export interface OrderDetail {
  order: Order;
  lineItems: OrderLineItem[];
  fulfillments: Fulfillment[];
  disputes: Dispute[];
  webhookEvent: { id: string; rawBody: string; receivedAt: number } | null;
}

export interface Listing {
  id: string;
  storefrontId: string;
  externalListingId: string;
  sku: string;
  title: string;
  priceCents: number;
  quantityAvailable: number;
  supplierId: string | null;
  matchConfidence: number | null;
  matchSource: 'exact_sku' | 'fuzzy_title' | 'embedding' | 'llm' | 'manual' | null;
  status: 'active' | 'paused_out_of_stock' | 'paused_margin' | 'paused_manual';
  matchedProductTitle: string | null;
  matchedProductImageUrl: string | null;
  matchedProductUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  apiBaseUrl: string;
  apiKeyRef: string;
  emailSenderPattern: string;
  parserId: string;
  active: number;
  kind: 'api' | 'manual';
  provider: 'amazon_business' | 'amazon_retail' | 'aliexpress' | 'cj' | 'generic_rest' | 'manual';
  createdAt: number;
}

export interface PendingSupplierOrder {
  id: string;
  fulfillmentId: string;
  orderId: string;
  supplierId: string;
  supplierName?: string;
  externalOrderNumber?: string;
  costCents: number;
  lineItems: { sku: string; quantity: number; title?: string }[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  decidedAt: number | null;
}

export interface Storefront {
  id: string;
  platform: 'shopify' | 'ebay' | 'amazon';
  shopDomain: string;
  nonApiMode: number;
  createdAt: number;
}

export interface Dispute {
  id: string;
  fulfillmentId: string;
  reason: string;
  draftSubject: string;
  draftBody: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  userId: string;
  minMarginCents: number;
  marginMode: 'absolute' | 'percent';
  minMarginPercent: number;
  autoFulfill: number;
}

export interface Metrics {
  ordersToday: number;
  avgMarginCents: number;
  autoExtractedRegexPercent: number;
  autoExtractedGeminiPercent: number;
  exceptionsOpen: number;
  listingsTotal: number;
  listingsMatched: number;
}

export interface SampleListing {
  title: string;
  url: string;
  priceCents: number;
}

export interface ProductOpportunity {
  id: string;
  keyword: string;
  totalSold: number;
  uniqueSellers: number;
  avgPriceCents: number;
  medianPriceCents: number;
  freeShippingPercent: number;
  opportunityScore: number;
  sampleListings: SampleListing[];
  scannedAt: number;
  aiVerdict: string | null;
  aiSellPriceMinCents: number | null;
  aiSellPriceMaxCents: number | null;
  aiTargetSourcePriceCents: number | null;
  aiMarginEstimateCents: number | null;
  aiRisk: string | null;
  recommendedKeywords: string[] | null;
}

export interface OpportunityAnalysis {
  verdict: string;
  sellPriceMinCents: number;
  sellPriceMaxCents: number;
  targetSourcePriceCents: number;
  marginEstimateCents: number;
  risk: string;
  recommendedKeywords: string[];
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? res.statusText, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
