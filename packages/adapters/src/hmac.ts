/**
 * Web Crypto HMAC-SHA256 verification shared by every inbound webhook route
 * (hard rule: every webhook is HMAC-verified before it is processed).
 */
export async function computeHmacSha256Base64(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return arrayBufferToBase64(signature);
}

export async function verifyHmacSha256(
  secret: string,
  payload: string,
  providedSignatureBase64: string,
): Promise<boolean> {
  const expected = await computeHmacSha256Base64(secret, payload);
  return timingSafeEqual(expected, providedSignatureBase64);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Constant-time string comparison to avoid timing side-channels on signature checks. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
