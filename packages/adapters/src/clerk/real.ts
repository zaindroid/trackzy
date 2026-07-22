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
