import type { WorkflowOrderPayload, WorkflowDisputePayload } from './workflows/types.js';

export interface Env {
  // Bindings
  DB: D1Database;
  ASSETS: Fetcher;
  ORDER_QUEUE: Queue<{ orderId: string }>;
  ORDER_QUEUE_DLQ: Queue<{ orderId: string }>;
  ORDER_WORKFLOW: Workflow<WorkflowOrderPayload>;
  DISPUTE_WORKFLOW: Workflow<WorkflowDisputePayload>;
  DISPUTE_EMAIL: SendEmail;

  // Vars
  MOCK_MODE: string;
  ENVIRONMENT: string;

  // Secrets (see .dev.vars.example)
  SHOPIFY_ACCESS_TOKEN?: string;
  SHOPIFY_WEBHOOK_SECRET?: string;
  SHOPIFY_API_VERSION?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  SEVENTEENTRACK_API_KEY?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
  SUPPLIER_API_KEY?: string;
}
