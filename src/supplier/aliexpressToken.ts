import { createHmac } from 'node:crypto';

// System/auth APIs use the /rest gateway and sign with HMAC-SHA256 over the
// api-path PLUS sorted key+value (path IS prepended here — unlike the /sync
// business calls). Verified live.
const REST_GATEWAY = 'https://api-sg.aliexpress.com/rest';

function signRest(path: string, params: Record<string, string>, secret: string): string {
  const base = path + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
  return createHmac('sha256', secret).update(base).digest('hex').toUpperCase();
}

/**
 * Mints a fresh AliExpress access_token from the (reusable) refresh_token, so
 * the crawler never runs with an expired 30-day access token. The refresh_token
 * is valid for ~60 days and can be reused across runs (verified), so it lives as
 * a static Actions secret and we simply refresh at the start of each crawl.
 * Returns null on any failure so the caller can fall back to a static token.
 */
export async function refreshAliexpressToken(
  appKey: string,
  appSecret: string,
  refreshToken: string,
  timeoutMs = 30_000,
): Promise<string | null> {
  const path = '/auth/token/refresh';
  const params: Record<string, string> = {
    app_key: appKey,
    sign_method: 'sha256',
    timestamp: String(Date.now()),
    refresh_token: refreshToken,
  };
  params.sign = signRest(path, params, appSecret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(REST_GATEWAY + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[aliexpress] token refresh HTTP ${res.status} — using static access token`);
      return null;
    }
    const json = (await res.json()) as { access_token?: string; code?: string; message?: string };
    if (!json.access_token) {
      console.warn(`[aliexpress] token refresh failed (code=${json.code} ${json.message ?? ''}) — using static access token`);
      return null;
    }
    return json.access_token;
  } catch (err) {
    console.warn('[aliexpress] token refresh error — using static access token:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
