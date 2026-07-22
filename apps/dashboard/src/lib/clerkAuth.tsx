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
    getToken().then(setToken);
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
