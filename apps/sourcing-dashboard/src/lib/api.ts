export interface ConnectionStatus {
  ebayConnected: boolean;
  cjConnected: boolean;
}

export interface SellerSettings {
  userId: string;
  defaultShippingCostCents: number;
  handlingTimeDays: number;
  returnPolicy: 'no_returns' | '30_day' | '60_day';
  targetMarginPercent: number;
  ebayFeePercent: number;
  itemLocationPostalCode: string;
}

export interface ProductCandidate {
  id: string;
  keyword: string;
  ebayAvgSoldPriceCents: number;
  ebayMedianPriceCents: number;
  ebaySoldCount: number;
  supplierProvider: string;
  supplierProductId: string;
  supplierCostCents: number;
  supplierProductUrl: string | null;
  supplierImageUrls: string[];
  marginCents: number;
  marginPercent: number;
  opportunityScore: number;
  suggestedSellPriceCents: number;
  generatedTitle: string;
  generatedDescription: string;
  generatedAspects: Record<string, string>;
  categoryId: string | null;
  status: 'draft' | 'listed' | 'dismissed';
  ebayItemId: string | null;
  createdAt: number;
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
