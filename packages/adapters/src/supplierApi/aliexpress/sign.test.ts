import { describe, expect, it } from 'vitest';
import { signAliExpressParams } from './sign.js';

describe('signAliExpressParams', () => {
  it('is deterministic for the same params and secret', async () => {
    const params = { app_key: 'ak', method: 'aliexpress.ds.text.search', timestamp: '1700000000000' };
    const sigA = await signAliExpressParams(params, 'secret');
    const sigB = await signAliExpressParams(params, 'secret');
    expect(sigA).toBe(sigB);
  });

  it('is independent of the input object key order (sorts before signing)', async () => {
    const sigA = await signAliExpressParams({ b: '2', a: '1', c: '3' }, 'secret');
    const sigB = await signAliExpressParams({ c: '3', a: '1', b: '2' }, 'secret');
    expect(sigA).toBe(sigB);
  });

  it('changes when any single param value changes', async () => {
    const base = await signAliExpressParams({ a: '1', b: '2' }, 'secret');
    const changed = await signAliExpressParams({ a: '1', b: '3' }, 'secret');
    expect(base).not.toBe(changed);
  });

  it('changes when the secret changes', async () => {
    const params = { a: '1', b: '2' };
    const sigA = await signAliExpressParams(params, 'secret-a');
    const sigB = await signAliExpressParams(params, 'secret-b');
    expect(sigA).not.toBe(sigB);
  });

  it('produces uppercase hex output', async () => {
    const sig = await signAliExpressParams({ a: '1' }, 'secret');
    expect(sig).toMatch(/^[0-9A-F]+$/);
    expect(sig).toBe(sig.toUpperCase());
  });

  it('omitting apiPath is equivalent to passing an empty string (the /sync gateway convention)', async () => {
    const params = { a: '1', b: '2' };
    const sigDefault = await signAliExpressParams(params, 'secret');
    const sigExplicitEmpty = await signAliExpressParams(params, 'secret', '');
    expect(sigDefault).toBe(sigExplicitEmpty);
  });

  it('a non-empty apiPath changes the signature (the /rest/auth/token/* convention) — confirmed against a live account', async () => {
    const params = { a: '1', b: '2' };
    const sigNoPath = await signAliExpressParams(params, 'secret');
    const sigWithPath = await signAliExpressParams(params, 'secret', '/auth/token/refresh');
    expect(sigWithPath).not.toBe(sigNoPath);
  });
});
