import { getConfig } from './config.js';

export interface ManualTaskPayload {
  sku: string;
  quantity: number;
  maxCostCents?: number;
  shipTo?: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  supplierOrderRef?: string;
}

export interface ActiveManualTask {
  id: string;
  orderId: string;
  supplierId: string;
  state: string;
  payload: ManualTaskPayload;
}

export interface PendingTrackingUpload {
  fulfillmentId: string;
  externalOrderId?: string;
  externalOrderNumber?: string;
  trackingNumber: string;
  carrier: string | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const config = await getConfig();
  if (!config.bearerToken) {
    throw new Error('Fulfillment Tracker extension is not signed in — open the popup to paste your access token.');
  }
  const res = await fetch(`${config.backendUrl}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.bearerToken}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`Fulfillment Tracker API request to ${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchActiveManualTask(): Promise<ActiveManualTask | null> {
  const data = await apiFetch<{ task: ActiveManualTask | null }>('/extension/active-manual-task');
  return data.task;
}

export async function markManualTaskOrdered(taskId: string, supplierOrderRef?: string): Promise<void> {
  await apiFetch(`/manual-tasks/${taskId}/mark-ordered`, {
    method: 'POST',
    body: JSON.stringify({ supplierOrderRef }),
  });
}

export async function fetchPendingTrackingUploads(): Promise<PendingTrackingUpload[]> {
  const data = await apiFetch<{ uploads: PendingTrackingUpload[] }>('/extension/pending-tracking-uploads');
  return data.uploads;
}

export async function completeTrackingUpload(fulfillmentId: string): Promise<void> {
  await apiFetch(`/extension/pending-tracking-uploads/${fulfillmentId}/complete`, { method: 'POST' });
}
