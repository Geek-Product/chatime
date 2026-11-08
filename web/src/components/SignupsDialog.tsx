import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Check, Loader2, UserCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from './Avatar';
import { api } from '../lib/api';

interface SignupRequest {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarColor: string;
  createdAt: string;
  message: string | null;
}

export const signupsKey = (workspaceId: string) => ['access-requests', workspaceId] as const;
export const signupBadgeKey = ['access-badge'] as const;

export function usePendingSignups(workspaceId: string | undefined, isAdmin: boolean) {
  return useQuery({
    queryKey: signupsKey(workspaceId ?? ''),
    queryFn: () => api.get<{ users: SignupRequest[] }>(`/workspaces/${workspaceId}/access-requests`),
    enabled: Boolean(workspaceId && isAdmin),
    staleTime: 30_000,
  });
}

/** Owners/admins review new accounts here; approving puts the person into `workspaceId`. */
export function SignupsDialog({
  workspaceId,
  workspaceName,
  onClose,
}: {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error } = usePendingSignups(workspaceId, true);
  const users = data?.users ?? [];

  const refreshCounts = () => {
    void qc.invalidateQueries({ queryKey: signupBadgeKey });
    void qc.invalidateQueries({ queryKey: ['members', workspaceId] });
  };

  const decide = useMutation({
    mutationFn: ({ userId, action }: { userId: string; action: 'approve' | 'decline' }) =>
      api.post(`/workspaces/${workspaceId}/access-requests/${userId}/${action}`),
    onSuccess: (_res, { userId, action }) => {
      const person = users.find((u) => u.id === userId);
      // Close once the queue is drained so the admin isn't left staring at an empty dialog.
      if (users.length <= 1) onClose();
      qc.setQueryData<{ users: SignupRequest[] }>(signupsKey(workspaceId), (prev) =>
        prev && { users: prev.users.filter((u) => u.id !== userId) });
      refreshCounts();
      toast[action === 'approve' ? 'success' : 'message'](
        action === 'approve'
          ? `${person?.displayName ?? 'They'} can now use ${workspaceName}`
          : `${person?.displayName ?? 'They'} was declined`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Sign-up requests"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-zinc-300 bg-white p-6 text-ink shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
              <UserCheck size={20} /> Sign-up requests
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              People waiting to join. Approving adds them to <b>{workspaceName}</b> and its public channels.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 -mx-2 flex-1 overflow-y-auto px-2">
          {isLoading ? (
            <div className="flex justify-center py-10 text-zinc-400"><Loader2 className="animate-spin" /></div>
          ) : error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{(error as Error).message}</p>
          ) : users.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500">
              Nobody is waiting right now.
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Pending sign-ups">
              {users.map((u) => (
                <li key={u.id} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3">
                  <Avatar name={u.displayName} color={u.avatarColor} size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {u.displayName} <span className="font-normal text-zinc-500">@{u.username}</span>
                    </p>
                    <p className="truncate text-xs text-zinc-500">{u.email}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">Requested {new Date(u.createdAt).toLocaleString()}</p>
                    {u.message && (
                      <p className="mt-1.5 rounded-md bg-panel px-2 py-1 text-xs text-zinc-700">“{u.message}”</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      aria-label={`Approve ${u.displayName}`}
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ userId: u.id, action: 'approve' })}
                      className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <Check size={14} /> Accept
                    </button>
                    <button
                      type="button"
                      aria-label={`Decline ${u.displayName}`}
                      disabled={decide.isPending}
                      onClick={() => decide.mutate({ userId: u.id, action: 'decline' })}
                      className="flex items-center gap-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                    >
                      <X size={14} /> Decline
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function invalidateSignups(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: signupBadgeKey });
  void qc.invalidateQueries({ queryKey: ['access-requests'] });
}
