import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, MessageSquare, Pencil, Shield, UserRound, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useProfile } from '../lib/profile';
import { requestProfileSettings } from '../lib/profile-settings';
import type { Member } from '../lib/types';

interface ProfileResponse {
  member: {
    id: string;
    username: string;
    displayName: string;
    avatarColor: string;
    createdAt: string;
    joinedAt: string;
    role: Member['role'];
  };
}

const joined = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

/** Floating profile card for the person selected via any name/avatar in the UI. */
export function UserProfileCard() {
  const profile = useProfile();
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  const target = profile.target;

  const { data, isLoading, error } = useQuery({
    queryKey: ['member-profile', profile.workspaceId, target?.userId],
    queryFn: () => api.get<ProfileResponse>(`/workspaces/${profile.workspaceId}/members/${target!.userId}`),
    enabled: Boolean(target && profile.workspaceId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && profile.closeProfile();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, profile]);

  if (!target) return null;
  const member = data?.member;
  const me = userRef.current;
  const isMe = me?.id === target.userId;
  // After a profile edit the card shows the new name/color immediately, without reopening it.
  const shown = isMe && me ? { ...target, displayName: me.displayName, username: me.username, avatarColor: me.avatarColor } : target;

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={profile.closeProfile} />
      <div
        role="dialog"
        aria-label={`Profile of ${shown.displayName}`}
        className="fixed top-16 right-6 z-50 w-80 overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
      >
        <div className="relative h-16 bg-gradient-to-r from-zinc-200 to-zinc-100" />
        <button
          type="button"
          onClick={profile.closeProfile}
          className="absolute top-2 right-2 rounded bg-white/80 p-1 text-zinc-700 hover:bg-white"
          aria-label="Close profile"
        >
          <X size={16} />
        </button>
        <div className="-mt-7 px-4 pb-4">
          <div className="rounded-md bg-white p-1" style={{ width: 60 }}>
            <Avatar name={shown.displayName} color={shown.avatarColor} size={52} online={target.online} />
          </div>
          <h3 className="mt-2 text-lg leading-tight font-bold text-ink">{shown.displayName}</h3>
          <p className="text-sm font-semibold text-zinc-600">
            @{shown.username}
            {isMe && <span className="ml-1 text-xs text-zinc-400">you</span>}
          </p>
          {isMe && <p className="mt-1 truncate text-xs text-zinc-500">{me.email}</p>}
          <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold">
            <span className={`inline-block h-2 w-2 rounded-full ${target.online ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
            <span className={target.online ? 'text-emerald-700' : 'text-zinc-500'}>{target.online ? 'Online' : 'Offline'}</span>
          </p>

          {error && <p className="mt-3 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{(error as Error).message}</p>}

          <dl className="mt-3 space-y-1.5 rounded-lg border border-line bg-panel px-3 py-2 text-xs text-zinc-700">
            <div className="flex items-center gap-2">
              <UserRound size={13} className="text-zinc-500" />
              <dt className="text-zinc-500">Role</dt>
              <dd className="ml-auto font-bold capitalize">
                {isLoading ? '…' : (member?.role ?? 'member')}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <Shield size={13} className="text-zinc-500" />
              <dt className="text-zinc-500">Joined workspace</dt>
              <dd className="ml-auto font-semibold">{isLoading ? '…' : joined(member?.joinedAt)}</dd>
            </div>
            <div className="flex items-center gap-2">
              <Mail size={13} className="text-zinc-500" />
              <dt className="text-zinc-500">Account created</dt>
              <dd className="ml-auto font-semibold">{isLoading ? '…' : joined(member?.createdAt)}</dd>
            </div>
          </dl>

          {isMe && (
            <button
              type="button"
              onClick={() => {
                profile.closeProfile();
                requestProfileSettings();
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm font-bold text-ink hover:bg-hover"
            >
              <Pencil size={14} /> Edit profile
            </button>
          )}

          {!isMe && (
            <button
              type="button"
              onClick={() => {
                profile.closeProfile();
                profile.onMessage(target.userId);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              <MessageSquare size={15} /> Message {shown.displayName.split(/\s+/)[0]}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
