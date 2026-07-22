import type { OAuthTokenSet, OnTokenRefreshed } from '../orderSource/iface.js';
import { TokenBucket, fetchWithBackoff } from '../rateLimit.js';
import type { GmailClient, GmailEnv, GmailMessage, GmailMessageSummary } from './iface.js';

const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

// Gmail API's default per-user quota is generous (250 quota units/user/sec);
// this stays well under it for a single-inbox polling use case.
function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 10, refillPerSecond: 5 });
}

interface GmailApiHeader {
  name: string;
  value: string;
}

interface GmailApiPart {
  mimeType: string;
  body?: { data?: string };
  parts?: GmailApiPart[];
}

interface GmailApiMessage {
  id: string;
  internalDate: string;
  payload: {
    headers: GmailApiHeader[];
    mimeType: string;
    body?: { data?: string };
    parts?: GmailApiPart[];
  };
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function findTextPart(part: GmailApiPart): string | undefined {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  for (const child of part.parts ?? []) {
    const found = findTextPart(child);
    if (found) return found;
  }
  return undefined;
}

function extractTextBody(payload: GmailApiMessage['payload']): string {
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const found = findTextPart(part);
    if (found) return found;
  }
  return '';
}

function header(headers: GmailApiHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/**
 * Gmail API (OAuth2 user token, `gmail.readonly` scope is sufficient — this
 * adapter never sends or modifies mail). Continuously polls a connected
 * inbox for supplier shipping-confirmation emails, per spec 6b.
 */
export class RealGmailClient implements GmailClient {
  private readonly bucket = newBucket();
  private tokens: OAuthTokenSet;

  constructor(
    private readonly env: GmailEnv,
    tokens: OAuthTokenSet,
    private readonly onTokenRefreshed: OnTokenRefreshed,
  ) {
    this.tokens = tokens;
  }

  private baseUrl(): string {
    return this.env.GMAIL_API_BASE_URL ?? 'https://gmail.googleapis.com';
  }

  private async ensureFreshToken(): Promise<string> {
    if (this.tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.tokens.accessToken;
    }
    const res = await fetchWithBackoff(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
          client_id: this.env.GMAIL_CLIENT_ID ?? '',
          client_secret: this.env.GMAIL_CLIENT_SECRET ?? '',
        }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Gmail OAuth token refresh failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.tokens = {
      accessToken: json.access_token,
      refreshToken: this.tokens.refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    await this.onTokenRefreshed(this.tokens);
    return this.tokens.accessToken;
  }

  private async request<T>(path: string): Promise<T> {
    const accessToken = await this.ensureFreshToken();
    const res = await fetchWithBackoff(
      `${this.baseUrl()}${path}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Gmail API request to ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async listNewMessages(query: string, sinceUnixMs: number): Promise<GmailMessageSummary[]> {
    const sinceSeconds = Math.floor(sinceUnixMs / 1000);
    const fullQuery = `${query} after:${sinceSeconds}`;
    const data = await this.request<{ messages?: { id: string }[] }>(
      `/gmail/v1/users/me/messages?q=${encodeURIComponent(fullQuery)}`,
    );
    return (data.messages ?? []).map((m) => ({ id: m.id }));
  }

  async getMessage(id: string): Promise<GmailMessage> {
    const data = await this.request<GmailApiMessage>(`/gmail/v1/users/me/messages/${id}?format=full`);
    return {
      id: data.id,
      subject: header(data.payload.headers, 'Subject'),
      from: header(data.payload.headers, 'From'),
      textBody: extractTextBody(data.payload),
      internalDate: Number.parseInt(data.internalDate, 10),
    };
  }
}
