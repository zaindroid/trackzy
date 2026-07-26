// AES-256-GCM credential encryption — identical scheme to trackzy's
// (enc:v1:<base64 iv>:<base64 ciphertext>), so the two products share the
// wire format even though they never share a database. One master key
// (CREDENTIAL_ENCRYPTION_KEY Worker secret) wraps every per-customer token.
// Typed against just the one field it needs (not the full Env) so it can be
// called with a workers-test `env` too, whose ProvidedEnv omits bindings like
// ASSETS that this function never touches.
type CryptoEnv = { CREDENTIAL_ENCRYPTION_KEY?: string };

const VERSION = 'v1';
const ALGO = 'AES-GCM';
const IV_BYTES = 12;

async function importKey(env: CryptoEnv): Promise<CryptoKey> {
  if (!env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
  }
  const keyBytes = base64ToBytes(env.CREDENTIAL_ENCRYPTION_KEY);
  return crypto.subtle.importKey('raw', keyBytes, { name: ALGO }, false, ['encrypt', 'decrypt']);
}

export async function encryptCredential(env: CryptoEnv, plaintext: string): Promise<string> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(plaintext));
  return `enc:${VERSION}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export async function decryptCredential(env: CryptoEnv, encoded: string): Promise<string> {
  const parts = encoded.split(':');
  if (parts.length !== 4 || parts[0] !== 'enc') {
    throw new Error('Not a valid encrypted credential');
  }
  const [, version, ivB64, ciphertextB64] = parts;
  if (version !== VERSION) {
    throw new Error(`Unsupported credential encryption version: ${version}`);
  }
  const key = await importKey(env);
  const iv = base64ToBytes(ivB64!);
  const ciphertext = base64ToBytes(ciphertextB64!);
  const plaintextBytes = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintextBytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
