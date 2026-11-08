import { useEffect, useRef } from 'react';
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { useAuth } from './lib/auth-context';
import AccessPendingPage from './pages/AccessPendingPage';
import ChatLayout from './pages/ChatLayout';
import LoginPage from './pages/LoginPage';
import type { AccessStatus, Workspace } from './lib/types';

function useAdminWorkspaces(enabled: boolean) {
  return useQuery({
    queryKey: ['access-workspaces'],
    queryFn: () => api.get<{ workspaces: { id: string; name: string }[]; pending: number }>('/access/workspaces'),
    enabled,
    staleTime: 60_000,
  });
}

function WorkspaceRedirect() {
  // Mirrors ChatLayout's fallback when a workspace is archived or the URL has the wrong id.
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (user?.status === 'pending' || user?.status === 'declined') return;
    api
      .get<{ workspaces: Workspace[] }>('/workspaces')
      .then(({ workspaces }) => navigate(workspaces[0] ? `/w/${workspaces[0].id}` : '/login', { replace: true }))
      .catch(() => navigate('/login', { replace: true }));
  }, [user?.status, navigate]);
  return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading…</div>;
}

export default function App() {
  const { user, loading, setStatus } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // A waiting account whose access token could not be renewed still holds a session; it is only
  // really signed out on an explicit logout or a login attempt (see LoginPage).
  const waiting = user?.status === 'pending' || user?.status === 'declined';
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  // Redirect in an effect, not during render: a render-time redirect recorded while signed out
  // would be replayed right after login and undo the screen the user should see next.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (pathname !== '/login' && !waitingRef.current) navigate('/login', { replace: true });
      return;
    }
    // A just-registered waiting account should not sit on the /login URL (reload would show the form).
    if (waiting && pathname === '/login') navigate('/welcome', { replace: true });
  }, [loading, user, pathname, navigate]);

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading…</div>;
  }

  if (!user) {
    return <LoginPage />;
  }

  if (waiting) {
    const onStatusChange: (status: AccessStatus) => void = (status) => setStatus(status);
    return (
      <Routes>
        <Route path="*" element={<AccessPendingPage onStatusChange={onStatusChange} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/w/:workspaceId/c/:channelId" element={<ChatLayoutRoute />} />
      <Route path="/w/:workspaceId/d/:conversationId" element={<ChatLayoutRoute />} />
      <Route path="/w/:workspaceId/mentions" element={<ChatLayoutRoute />} />
      <Route path="/w/:workspaceId" element={<ChatLayoutRoute />} />
      <Route path="*" element={<WorkspaceRedirect />} />
    </Routes>
  );
}

/** Owner/admin status is per workspace: the sign-ups list is only shown where they can act on it. */
function ChatLayoutRoute() {
  const { workspaceId } = useParams();
  const adminQ = useAdminWorkspaces(true);
  const isAdmin = Boolean(workspaceId && adminQ.data?.workspaces.some((w) => w.id === workspaceId));
  return <ChatLayout isAdmin={isAdmin} />;
}
