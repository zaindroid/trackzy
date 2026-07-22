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

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  apiBaseUrl: string;
  apiKeyRef: string;
  emailSenderPattern: string;
  parserId: string;
  active: number;
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
