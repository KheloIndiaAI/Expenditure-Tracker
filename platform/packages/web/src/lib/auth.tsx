/**
 * Auth context. RBAC is enforced at the data layer (NFR-9) — this only decides
 * what the UI offers, never what the server permits.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthedUser, Capability } from '@efip/shared';
import { api, getToken, setToken } from './api.ts';

interface AuthValue {
  user: AuthedUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (cap: Capability) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      async login(email, password) {
        const { token, user: u } = await api.login(email, password);
        setToken(token);
        setUser(u);
      },
      logout() {
        setToken(null);
        setUser(null);
        location.href = '/login';
      },
      can(cap) {
        return !!user?.capabilities.includes(cap);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
