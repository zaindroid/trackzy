import type { Env } from '../env.js';

const VERSION = 'v1';
const ALGO = 'AES-GCM';
const IV_BYTES = 12;

/**
 * Encrypts/decrypts customer-supplied credentials (OAuth tokens, API keys)
 * before they're persisted to any `*_ref` column — see DECISIONS.md for why
 * this exists: this app moved from single-tenant (one developer's own
 * Cloudflare Worker secrets) to multi-tenant (arbitrary customers' own eBay/
 * AliExpress/CJ credentials), and those can't sit in D1 as plaintext.
 * AES-256-GCM via Workers' built-in Web Crypto rather than an external
 * KMS — one master key (`CREDENTIAL_ENCRYPTION_KEY`, itself a Worker
 * secret, never a customer credential) wraps everything else.
 */
async function importKey(env: Env): Promise<CryptoKey> {
  if (!env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not configured');
  }
  const keyBytes = base64ToBytes(env.CREDENTIAL_ENCRYPTION_KEY);
  return crypto.subtle.importKey('raw', keyBytes, { name: ALGO }, false, ['encrypt', 'decrypt']);
}

/** Returns `enc:v1:<base64 iv>:<base64 ciphertext>` — the format resolveSecretRef recognizes. */
export async function encryptCredential(env: Env, plaintext: string): Promise<string> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, new TextEncoder().encode(plaintext));
  return `enc:${VERSION}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
}

/** Reverses encryptCredential. Throws on a version mismatch or auth-tag failure (tampered/corrupt data) rather than silently returning garbage. */
export async function decryptCredential(env: Env, encoded: string): Promise<string> {
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
