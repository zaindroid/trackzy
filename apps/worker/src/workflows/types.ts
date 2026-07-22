export interface WorkflowOrderPayload {
  orderId: string;
  /** Skips the margin threshold check — set when a human approves a previously-rejected order. */
  forceApprove?: boolean;
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
