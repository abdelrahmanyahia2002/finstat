'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthUser, SessionResponse } from '@finstat/shared';

import { api, apiFetch, tokens } from './api';

interface SessionValue {
  user: AuthUser | null;
  /** Null while the stored session is being checked on first paint. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    // Trust the stored user for the first paint, then confirm it against the
    // API so a revoked or deactivated account does not linger on screen.
    const stored = tokens.user();
    if (stored) setUser(stored);

    (async () => {
      if (!tokens.access()) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const fresh = await apiFetch<AuthUser>('/auth/me');
        if (!cancelled) setUser(fresh);
      } catch {
        if (!cancelled) {
          tokens.clear();
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await apiFetch<SessionResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
        skipAuth: true,
      });
      tokens.save(session);
      setUser(session.user);
      router.push('/');
    },
    [router],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const session = await apiFetch<SessionResponse>('/auth/register', {
        method: 'POST',
        body: { name, email, password },
        skipAuth: true,
      });
      tokens.save(session);
      setUser(session.user);
      router.push('/');
    },
    [router],
  );

  const signOut = useCallback(async () => {
    const refreshToken = tokens.refresh();
    if (refreshToken) {
      // Best effort: the local session goes either way.
      await api.post('/auth/logout', { refreshToken }).catch(() => undefined);
    }
    tokens.clear();
    setUser(null);
    router.push('/login');
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, signIn, register, signOut }),
    [user, loading, signIn, register, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession has to be used inside a SessionProvider.');
  return context;
}
