import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ClerkProvider, useAuth as useClerkAuth, SignIn, useUser } from '@clerk/clerk-react';
import { AuthContext, CLERK_PUBLISHABLE_KEY, type AuthContextValue } from './auth.js';

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken, signOut } = useClerkAuth();
  const { isLoaded } = useUser();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) {
      setToken(null);
      return;
    }
    // Clerk session tokens are short-lived (60s by default) — caching one
    // `getToken()` result for the life of the session meant every API call
    // started 401ing a minute after sign-in, with no visible error anywhere
    // in the app (see DECISIONS.md). Refreshed well under that lifetime so
    // whatever's cached in `token` is always usable by the time a request
    // actually goes out.
    let cancelled = false;
    const refresh = () => {
      getToken().then((t) => {
        if (!cancelled) setToken(t);
      });
    };
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isSignedIn, getToken]);

  const value = useMemo<AuthContextValue>(
    () => ({ token, loginAsDevUser: () => undefined, logout: () => void signOut() }),
    [token, signOut],
  );

  if (!isLoaded) return null;
  if (!isSignedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <SignIn />
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Real Clerk auth path — only mounted when VITE_CLERK_PUBLISHABLE_KEY is a real key. */
export function ClerkAuthProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY as string}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}
