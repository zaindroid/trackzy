import type { AuthSession, ClerkEnv, SessionVerifier } from './iface.js';

export class RealSessionVerifier implements SessionVerifier {
  constructor(private readonly env: ClerkEnv) {}

  async verifySession(request: Request): Promise<AuthSession | null> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length);

    try {
      // Dynamically imported so @clerk/backend's module graph is only linked
      // when a real (non-mock) session actually needs verifying — some of
      // its transitive CJS dependencies fail to bundle for the Workers
      // runtime under static import even when never invoked at runtime
      // (see DECISIONS.md milestone 7).
      const { verifyToken } = await import('@clerk/backend');
      const payload = await verifyToken(token, { secretKey: this.env.CLERK_SECRET_KEY ?? '' });
      return { clerkUserId: payload.sub };
    } catch {
      return null;
    }
  }
}

type ClerkEmailAddress = { id: string; email_address: string };
type ClerkUserResponse = { primary_email_address_id?: string; email_addresses?: ClerkEmailAddress[] };

/**
 * Fetches a Clerk user's primary email via the Backend API — needed to
 * auto-provision our own `users` row the first time a real (newly signed
 * up) Clerk session hits the API with no matching account yet (see
 * authMiddleware.ts and DECISIONS.md). The verified JWT session token alone
 * doesn't carry email by default (no custom template configured), so this
 * is a real API call, not just a claims read.
 *
 * Deliberately a raw `fetch` against the REST API rather than
 * `createClerkClient().users.getUser()`: the SDK's request path pulls in
 * `snakecase-keys` -> `map-obj`, which throws "Cannot use require() to
 * import an ES Module" under the Workers runtime's CJS/ESM interop (both
 * in vitest-pool-workers and, per Clerk backend SDK's known workerd
 * limitations, real workerd too) — the same class of bundling issue noted
 * for `verifyToken` in DECISIONS.md milestone 7, except this one is hit at
 * call time, not just at bundle time, so dynamic import alone can't dodge
 * it. We only need two fields off the response, so skip the SDK entirely.
 */
export async function fetchClerkUserEmail(env: ClerkEnv, clerkUserId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY ?? ''}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ClerkUserResponse;
    const addresses = data.email_addresses ?? [];
    const primary = addresses.find((e) => e.id === data.primary_email_address_id);
    return primary?.email_address ?? addresses[0]?.email_address ?? null;
  } catch {
    return null;
  }
}
