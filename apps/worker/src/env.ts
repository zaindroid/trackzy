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

  // Phase 2 secrets (see .dev.vars.example)
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_OAUTH_ACCESS_TOKEN?: string;
  EBAY_OAUTH_REFRESH_TOKEN?: string;
  EBAY_API_BASE_URL?: string;
  AMAZON_LWA_CLIENT_ID?: string;
  AMAZON_LWA_CLIENT_SECRET?: string;
  AMAZON_MARKETPLACE_ID?: string;
  AMAZON_SELLER_ID?: string;
  AMAZON_OAUTH_ACCESS_TOKEN?: string;
  AMAZON_OAUTH_REFRESH_TOKEN?: string;
  AMAZON_SP_API_BASE_URL?: string;
  AMAZON_BUSINESS_API_KEY?: string;
  AMAZON_BUSINESS_BASE_URL?: string;
  ALIEXPRESS_APP_KEY?: string;
  ALIEXPRESS_APP_SECRET?: string;
  ALIEXPRESS_OAUTH_ACCESS_TOKEN?: string;
  ALIEXPRESS_OAUTH_REFRESH_TOKEN?: string;
  ALIEXPRESS_GATEWAY_URL?: string;
  ALIEXPRESS_REST_BASE_URL?: string;
  CJ_API_KEY?: string;
  CJ_BASE_URL?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_OAUTH_ACCESS_TOKEN?: string;
  GMAIL_OAUTH_REFRESH_TOKEN?: string;
  GMAIL_API_BASE_URL?: string;
  BLUECARE_EXPRESS_API_KEY?: string;
  AQUILINE_API_KEY?: string;
  TRACKING_PROXY_PROVIDER?: 'bluecare_express' | 'aquiline';
  GEMINI_EMBEDDING_MODEL?: string;
}
