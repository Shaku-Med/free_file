import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type AuthContextValue = {
  /** Whether the user is currently signed in. */
  isAuthenticated: boolean;
  /** Auth token, if any. Stored in memory for now  wire to secure storage later. */
  token: string | null;
  /** Mark the user as signed in with a token from the OAuth flow. */
  signIn: (token: string) => void;
  /** Clear the session. */
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);

  const signIn = useCallback((nextToken: string) => setToken(nextToken), []);
  const signOut = useCallback(() => setToken(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: token !== null,
      token,
      signIn,
      signOut,
    }),
    [token, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
