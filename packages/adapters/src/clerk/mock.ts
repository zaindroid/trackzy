import type { AuthSession, SessionVerifier } from './iface.js';

/** Mock auth: `Authorization: Bearer dev-user` maps to the seeded demo user. */
export class MockSessionVerifier implements SessionVerifier {
  async verifySession(request: Request): Promise<AuthSession | null> {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return null;
    return { clerkUserId: token };
  }
}
