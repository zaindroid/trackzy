export interface ClerkEnv {
  MOCK_MODE?: string;
  CLERK_SECRET_KEY?: string;
  CLERK_PUBLISHABLE_KEY?: string;
}

export interface AuthSession {
  clerkUserId: string;
}

export interface SessionVerifier {
  verifySession(request: Request): Promise<AuthSession | null>;
}
