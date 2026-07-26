import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface AuthContextValue {
  token: string | null;
  loginAsDevUser: () => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = 'sourcing-portal:dev-token';

export const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
export const CLERK_CONFIGURED = Boolean(CLERK_PUBLISHABLE_KEY) && !CLERK_PUBLISHABLE_KEY?.startsWith('PLACEHOLDER__');

/**
 * Mock auth provider used whenever Clerk isn't configured (spec section 10:
 * "mock accepts token 'dev-user'"). A real deployment sets
 * VITE_CLERK_PUBLISHABLE_KEY and swaps this for <ClerkProvider> — see
 * DEPLOY.md TODO(HUMAN) for wiring a real Clerk app.
 */
export function MockAuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  useEffect(() => {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  }, [token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      loginAsDevUser: () => setToken('dev-user'),
      logout: () => setToken(null),
    }),
    [token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthToken(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthToken must be used within an AuthProvider');
  return ctx;
}
