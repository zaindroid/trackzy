import type { Env } from '../env.js';

/**
 * Resolves a `*_ref` pointer column (e.g. `storefronts.webhookSecretRef`,
 * `users.gmailAccessTokenRef`) to its actual secret value. In this
 * single-tenant demo, refs are literal `env:VAR_NAME` strings pointing at a
 * process env var; a real multi-tenant deployment would instead point at a
 * per-tenant secret store. Shared by every route/pipeline that resolves a
 * `*_ref` column so the convention only lives in one place.
 */
export function resolveSecretRef(ref: string, env: Env): string {
  if (ref.startsWith('env:')) {
    const key = ref.slice('env:'.length) as keyof Env;
    return (env[key] as string | undefined) ?? '';
  }
  return ref;
}
