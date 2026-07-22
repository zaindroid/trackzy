/**
 * AliExpress Open Platform (TOP-style gateway) request signing: every
 * parameter (system + business, excluding `sign` itself) is sorted
 * lexicographically by key, concatenated as `key1value1key2value2...`, and
 * HMAC-SHA256'd with the app secret — AliExpress's documented `sha256`
 * sign_method. Pure and deterministic given the same params + secret, which
 * is what makes it directly unit-testable without any network access.
 */
export async function signAliExpressParams(
  params: Record<string, string>,
  appSecret: string,
): Promise<string> {
  const sortedKeys = Object.keys(params).sort();
  const concatenated = sortedKeys.map((k) => `${k}${params[k]}`).join('');

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
