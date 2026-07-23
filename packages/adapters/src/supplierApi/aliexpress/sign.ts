/**
 * AliExpress Open Platform request signing: every parameter (system +
 * business, excluding `sign` itself) is sorted lexicographically by key,
 * concatenated as `key1value1key2value2...`, and HMAC-SHA256'd with the app
 * secret — AliExpress's documented `sha256` sign_method. Pure and
 * deterministic given the same params + secret, which is what makes it
 * directly unit-testable without any network access.
 *
 * `apiPath` (optional, defaults to none): AliExpress actually runs two
 * different gateway families with two different signing conventions,
 * confirmed empirically against a live account (2026-07 — see DECISIONS.md):
 * the `/sync` JSON-RPC-style gateway (`aliexpress.ds.*` business methods)
 * signs params alone, while the `/rest/auth/token/*` OAuth endpoints require
 * the request path prepended to the concatenated params before signing
 * (`POST/GET /sync` returns `InvalidApiPath` for `auth/token/create` as a
 * `method`; the params-only signature returns `IncompleteSignature` against
 * `/rest/auth/token/create` — the path-prefixed variant is what a real
 * account actually accepted).
 */
export async function signAliExpressParams(
  params: Record<string, string>,
  appSecret: string,
  apiPath = '',
): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  const concatenated = apiPath + sortedKeys.map((k) => `${k}${params[k]}`).join('');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(concatenated));
  return [...new Uint8Array(signatureBuffer)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
