/**
 * Auth context for the login / administration SPA.
 *
 * The server sets an httpOnly session cookie on successful login, so there is no
 * token to keep in JS. The signed-in user is fetched from `/api/auth/me` rather
 * than remembered from the login response, which means a role change, a
 * deactivation or a revoked module is picked up on the next load instead of
 * lingering in client state.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthedUser } from '@efip/shared';
import { api } from './api.ts';

interface AuthValue {
  user: AuthedUser | null;
  /** Null while the first `me` call is still in flight — render nothing yet. */
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  refresh: () => Promise<void>;
  setUser: (u: AuthedUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null); // 401 simply means "not signed in"
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      setUser,
      refresh,
      async login(username, password) {
        await api.login(username, password);
        // Cookie is now set; hand off to the server-gated dashboard.
        window.location.href = '/';
      },
      async logout() {
        await api.logout();
        window.location.href = '/login';
      },
    }),
    [user, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
