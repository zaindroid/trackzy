import type { Env } from '../env.js';
import { decryptCredential, encryptCredential } from './credentialCrypto.js';
import { now } from './id.js';

const STATE_TTL_MS = 15 * 60_000;

/**
 * Encodes the initiating user into the OAuth `state` param as an encrypted,
 * time-stamped token — so the unauthenticated provider callback can recover
 * which user started the flow without a DB-backed state table (trackzy uses a
 * table; this app is small enough that the stateless encrypted-token approach
 * is cleaner). Reuses the same AES key as credential encryption.
 */
export async function signOauthState(env: Env, userId: string): Promise<string> {
  return encryptCredential(env, JSON.stringify({ userId, ts: now() }));
}

export async function verifyOauthState(env: Env, state: string): Promise<string | null> {
  try {
    const decoded = JSON.parse(await decryptCredential(env, state)) as { userId: string; ts: number };
    if (now() - decoded.ts > STATE_TTL_MS) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}
