import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { encryptCredential, decryptCredential } from './credentialCrypto.js';

describe('credentialCrypto', () => {
  it('round-trips a plaintext value through encrypt then decrypt', async () => {
    const encrypted = await encryptCredential(env, 'v^1.1#i123-a1b2c3d4e5f6');
    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('v^1.1#i123-a1b2c3d4e5f6');

    const decrypted = await decryptCredential(env, encrypted);
    expect(decrypted).toBe('v^1.1#i123-a1b2c3d4e5f6');
  });

  it('produces a different ciphertext each time (random IV), even for the same plaintext', async () => {
    const first = await encryptCredential(env, 'same-value');
    const second = await encryptCredential(env, 'same-value');
    expect(first).not.toBe(second);
    expect(await decryptCredential(env, first)).toBe('same-value');
    expect(await decryptCredential(env, second)).toBe('same-value');
  });

  it('fails to decrypt under a different key', async () => {
    const encrypted = await encryptCredential(env, 'secret-token');
    const wrongKeyEnv = { ...env, CREDENTIAL_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
    await expect(decryptCredential(wrongKeyEnv, encrypted)).rejects.toThrow();
  });

  it('throws on a malformed/unversioned encoded value rather than returning garbage', async () => {
    await expect(decryptCredential(env, 'not-an-encrypted-value')).rejects.toThrow();
    await expect(decryptCredential(env, 'enc:v2:AAAA:BBBB')).rejects.toThrow(/version/);
  });

  it('throws when CREDENTIAL_ENCRYPTION_KEY is not configured', async () => {
    const noKeyEnv = { ...env, CREDENTIAL_ENCRYPTION_KEY: undefined };
    await expect(encryptCredential(noKeyEnv, 'x')).rejects.toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
  });
});
