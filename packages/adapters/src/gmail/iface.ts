import type { OAuthTokenSet, OnTokenRefreshed } from '../orderSource/iface.js';

export interface GmailEnv {
  MOCK_MODE?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_API_BASE_URL?: string;
}

export interface GmailMessageSummary {
  id: string;
}

export interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  textBody: string;
  internalDate: number; // unix ms
}

export interface GmailClient {
  /** `query` uses Gmail search syntax, e.g. `subject:(shipped OR tracking)`. */
  listNewMessages(query: string, sinceUnixMs: number): Promise<GmailMessageSummary[]>;
  getMessage(id: string): Promise<GmailMessage>;
}

export interface GmailClientConfig {
  tokens: OAuthTokenSet;
  onTokenRefreshed: OnTokenRefreshed;
}
