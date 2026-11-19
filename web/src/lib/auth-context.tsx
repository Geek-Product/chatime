import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { type AuthResponse, api, applySession, bootstrapSession, logout as apiLogout, setAccessToken } from './api';
import { clearOfflineCache } from './offline';
import { resetPresence } from './presence';
import { socket } from './socket';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; displayName: string; password: string; message?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setStatus: (status: 'approved' | 'pending' | 'declined') => void;
  updateUser: (patch: Partial<Pick<User, 'username' | 'displayName' | 'email' | 'avatarColor' | 'title' | 'avatarUrl'>>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrapSession()
      .then((session) => session && setUser(session.user))
      .finally(() => setLoading(false));
  }, []);

  // A tab that started offline has no access token yet; pick the session up when the network returns.
  // Signed-out tabs stay signed out (their refresh cookie may still exist if the logout call failed).
  const signedIn = user !== null;
  useEffect(() => {
    if (!signedIn) return;
    const onOnline = () => {
      bootstrapSession()
        .then((session) => {
          if (!session) return;
          setUser(session.user);
          socket.restart();
          void qc.invalidateQueries();
        })
        .catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [qc, signedIn]);

  const apply = useCallback((session: AuthResponse) => {
    // Cached chats belong to the previous account.
    clearOfflineCache(qc);
    applySession(session);
    // Start the new session on a fresh socket: an old tab's connection would never re-send `hello`.
    socket.stop();
    resetPresence();
    setUser(session.user);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    apply(await api.post<AuthResponse>('/auth/login', { email, password }));
  }, [apply]);

  const register = useCallback(async (data: { email: string; username: string; displayName: string; password: string; message?: string }) => {
    apply(await api.post<AuthResponse>('/auth/register', data));
  }, [apply]);

  const logout = useCallback(async () => {
    // Close the socket first so the server marks this user offline for everyone else.
    socket.stop();
    resetPresence();
    // Local sign-out must succeed even when the logout request cannot reach the server.
    await apiLogout().catch(() => {});
    clearOfflineCache(qc);
    setAccessToken(null);
    setUser(null);
  }, [qc]);

  const setStatus = useCallback((status: 'approved' | 'pending' | 'declined') => {
    setUser((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const updateUser = useCallback((patch: Partial<Pick<User, 'username' | 'displayName' | 'email' | 'avatarColor' | 'title' | 'avatarUrl'>>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, setStatus, updateUser }),
    [user, loading, login, register, logout, setStatus, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
