import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { resolveSecretRef } from './secretRef.js';
import { encryptCredential } from './credentialCrypto.js';

describe('resolveSecretRef', () => {
  it('resolves an env: prefixed ref to the matching Worker secret/var', async () => {
    expect(await resolveSecretRef('env:SHOPIFY_WEBHOOK_SECRET', env)).toBe('test-shopify-webhook-secret');
  });

  it('returns an empty string for an env: ref pointing at an unset var', async () => {
    expect(await resolveSecretRef('env:SOME_UNSET_VAR', env)).toBe('');
  });

  it('decrypts an enc: prefixed ref (customer-supplied credential)', async () => {
    const encrypted = await encryptCredential(env, 'customer-oauth-token');
    expect(await resolveSecretRef(encrypted, env)).toBe('customer-oauth-token');
  });

  it('returns any other string as a literal value unchanged', async () => {
    expect(await resolveSecretRef('some-literal-value', env)).toBe('some-literal-value');
  });
});
