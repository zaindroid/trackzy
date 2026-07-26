import type { Env } from '../env.js';
import { decryptCredential } from './credentialCrypto.js';

/**
 * Resolves a `*_ref` pointer column (e.g. `storefronts.webhookSecretRef`,
 * `users.gmailAccessTokenRef`) to its actual secret value. Three shapes:
 * `env:VAR_NAME` points at a process-wide Worker secret (this app's own
 * credentials — Shopify/eBay/AliExpress client id+secret, etc. — never a
 * customer's); `enc:v1:...` is a customer-supplied credential encrypted by
 * credentialCrypto.ts (see DECISIONS.md — this app moved from single-tenant
 * to multi-tenant, and per-customer OAuth tokens/API keys can't be
 * plaintext); anything else is returned as a literal value unchanged
 * (back-compat for any pre-encryption test fixture or seed data).
 */
export async function resolveSecretRef(ref: string, env: Env): Promise<string> {
  if (ref.startsWith('env:')) {
    const key = ref.slice('env:'.length) as keyof Env;
    return (env[key] as string | undefined) ?? '';
  }
  if (ref.startsWith('enc:')) {
    return decryptCredential(env, ref);
  }
  return ref;
}
