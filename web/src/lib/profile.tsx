import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from './api';
import type { Conversation } from './types';

/** The card currently shown by `UserProfileCard`. */
export interface ProfileTarget {
  userId: string;
  /** Workspace the card is shown in; membership details come from it. */
  workspaceId: string;
  displayName: string;
  username: string;
  avatarColor: string;
  online: boolean;
}

interface ProfileValue {
  target: ProfileTarget | null;
  /** Workspace of the active chat route (null outside `/w/:workspaceId`). */
  workspaceId: string | null;
  openProfile: (target: ProfileTarget) => void;
  closeProfile: () => void;
  /** Opens a 1:1 DM with the user of an open profile card. */
  onMessage: (userId: string) => void;
}

const ProfileContext = createContext<ProfileValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<ProfileTarget | null>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const workspaceId = pathname.match(/^\/w\/([^/]+)/)?.[1] ?? null;

  const openProfile = useCallback((next: ProfileTarget) => setTarget(next), []);
  const closeProfile = useCallback(() => setTarget(null), []);

  const onMessage = useCallback((userId: string) => {
    if (!workspaceId) return;
    api.post<{ conversation: Conversation }>(`/workspaces/${workspaceId}/conversations`, { userId })
      .then(({ conversation }) => navigate(`/w/${workspaceId}/d/${conversation.id}`))
      .catch((e: Error) => toast.error(e.message));
  }, [workspaceId, navigate]);

  const value = useMemo<ProfileValue>(
    () => ({ target, workspaceId, openProfile, closeProfile, onMessage }),
    [target, workspaceId, openProfile, closeProfile, onMessage],
  );
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile() {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider');
  return ctx;
}
