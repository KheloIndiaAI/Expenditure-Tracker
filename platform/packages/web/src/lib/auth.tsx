/**
 * Auth context for the login SPA.
 *
 * The server sets an httpOnly session cookie on successful login, so there is no
 * token to keep in JS. After signing in we do a full navigation to "/", which
 * the server serves as the gated dashboard once the cookie is present.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from './api.ts';

interface AuthValue {
  login: (username: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useMemo<AuthValue>(
    () => ({
      async login(username, password) {
        await api.login(username, password);
        // Cookie is now set; hand off to the server-gated dashboard.
        window.location.href = '/';
      },
    }),
    [],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
