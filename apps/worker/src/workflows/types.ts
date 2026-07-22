export interface WorkflowOrderPayload {
  orderId: string;
}

export interface WorkflowDisputePayload {
  fulfillmentId: string;
  reason: string;
}

export interface TrackingReceivedEvent {
  fulfillmentId: string;
  trackingNumber: string;
  carrierDeclared?: string;
  sku?: string;
  source: 'regex' | 'gemini' | 'manual';
}

export interface TrackingStatusEvent {
  fulfillmentId: string;
  status: 'in_transit' | 'delivered' | 'exception';
}
