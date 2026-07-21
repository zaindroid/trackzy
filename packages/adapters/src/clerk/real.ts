import { verifyToken } from '@clerk/backend';
import type { AuthSession, ClerkEnv, SessionVerifier } from './iface.js';

export class RealSessionVerifier implements SessionVerifier {
  constructor(private readonly env: ClerkEnv) {}

  async verifySession(request: Request): Promise<AuthSession | null> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length);

    try {
      const payload = await verifyToken(token, { secretKey: this.env.CLERK_SECRET_KEY ?? '' });
      return { clerkUserId: payload.sub };
    } catch {
      return null;
    }
  }
}
