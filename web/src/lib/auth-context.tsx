import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type AuthResponse, api, applySession, bootstrapSession, logout as apiLogout, setAccessToken } from './api';
import type { User } from './types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { email: string; username: string; displayName: string; password: string; message?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setStatus: (status: 'approved' | 'pending' | 'declined') => void;
  updateUser: (patch: Partial<Pick<User, 'username' | 'displayName' | 'avatarColor' | 'title'>>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    bootstrapSession()
      .then((session) => session && setUser(session.user))
      .finally(() => setLoading(false));
  }, []);

  const apply = useCallback((session: AuthResponse) => {
    applySession(session);
    setUser(session.user);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    apply(await api.post<AuthResponse>('/auth/login', { email, password }));
  }, [apply]);

  const register = useCallback(async (data: { email: string; username: string; displayName: string; password: string; message?: string }) => {
    apply(await api.post<AuthResponse>('/auth/register', data));
  }, [apply]);

  const logout = useCallback(async () => {
    await apiLogout();
    setAccessToken(null);
    setUser(null);
  }, []);

  const setStatus = useCallback((status: 'approved' | 'pending' | 'declined') => {
    setUser((prev) => (prev ? { ...prev, status } : prev));
  }, []);

  const updateUser = useCallback((patch: Partial<Pick<User, 'username' | 'displayName' | 'avatarColor' | 'title'>>) => {
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
