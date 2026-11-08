import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Ban, CheckCircle2, Clock, LogOut, RefreshCw } from 'lucide-react';
import { Avatar } from '../components/Avatar';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useAccessSocket } from '../lib/useAccessSocket';
import type { AccessStatus } from '../lib/types';

/**
 * Shown to signed-in accounts that have no workspace yet. The access status lives on the
 * session (re-read on refresh), and the realtime `access.changed` event flips it.
 */
export default function AccessPendingPage({ onStatusChange }: { onStatusChange: (status: AccessStatus) => void }) {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const declined = user?.status === 'declined';

  async function settledWorkspace(): Promise<string | null> {
    const access = await api.get<{ workspaceIds: string[] }>('/access/me').catch(() => null);
    return access?.workspaceIds[0] ?? null;
  }

  // The admin's decision arrives over the socket; fall back to the button/interval below.
  useAccessSocket((status) => {
    if (status === 'declined') {
      onStatusChange('declined');
      return;
    }
    void settledWorkspace().then((first) => {
      qc.clear();
      // Flip the auth status first: while it stays 'pending' the app renders this page for any URL.
      onStatusChange('approved');
      if (first) navigate(`/w/${first}`, { replace: true });
    });
  });

  async function check() {
    setChecking(true);
    try {
      const [me, access] = await Promise.all([
        api.get<{ user: { status?: AccessStatus } }>('/auth/me').catch(() => null),
        api.get<{ status: AccessStatus; workspaceIds: string[] }>('/access/me').catch(() => null),
      ]);
      setCheckedAt(new Date());
      if (!me || !access) return;
      if (access.status === 'approved') {
        onStatusChange('approved');
        qc.clear();
        navigate(access.workspaceIds[0] ? `/w/${access.workspaceIds[0]}` : '/', { replace: true });
        return;
      }
      onStatusChange(access.status === 'declined' || me.user.status === 'declined' ? 'declined' : 'pending');
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (declined) return;
    const id = setInterval(() => void check(), 20_000);
    return () => clearInterval(id);
    // check() only reads refs/state setters; a stable interval is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declined]);

  return (
    <div className="flex min-h-full items-center justify-center bg-[#f4ede4] px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 shadow-sm" role="status">
        <div className="flex items-center gap-3">
          {user && <Avatar name={user.displayName} color={user.avatarColor} size={48} />}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-ink">Hi {user?.displayName ?? 'there'}</p>
            <p className="truncate text-sm text-zinc-500">{user?.email}</p>
          </div>
        </div>

        {declined ? (
          <>
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <Ban className="mt-0.5 shrink-0 text-red-600" size={20} />
              <div>
                <p className="font-semibold text-red-800">Your sign-up wasn't approved</p>
                <p className="mt-1 text-sm text-red-700">
                  A workspace admin declined this request. If you think that was a mistake, contact the admin so they
                  can invite you again, or sign up with the email address they expect.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 py-2.5 text-sm font-semibold text-ink hover:bg-zinc-50"
            >
              <LogOut size={15} /> Back to sign in
            </button>
          </>
        ) : (
          <>
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <Clock className="mt-0.5 shrink-0 text-amber-600" size={20} />
              <div>
                <p className="font-semibold text-amber-900">Your account is waiting for approval</p>
                <p className="mt-1 text-sm text-amber-800">
                  An admin of the workspace can see your request in their sign-ups list. You'll get in as soon as
                  they accept — this page updates by itself.
                </p>
              </div>
            </div>

            <ol className="mt-5 space-y-2 text-sm text-zinc-600">
              <li className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600" /> Account created
              </li>
              <li className="flex items-center gap-2">
                <span className="flex h-4 w-4 items-center justify-center">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                </span>
                Waiting for an admin to accept your sign-up
              </li>
              <li className="flex items-center gap-2 text-zinc-400">
                <span className="h-4 w-4 rounded-full border border-zinc-300" /> Your channels appear here
              </li>
            </ol>

            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-accent py-2.5 text-sm font-bold text-white transition hover:bg-purple-900 disabled:opacity-60"
            >
              <RefreshCw size={15} className={checking ? 'animate-spin' : undefined} />
              {checking ? 'Checking…' : 'Check again'}
            </button>
            {checkedAt && !checking && (
              <p className="mt-2 text-center text-xs text-zinc-500">Checked at {checkedAt.toLocaleTimeString()}</p>
            )}
          </>
        )}

        {!declined && (
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-4 flex w-full items-center justify-center gap-2 py-1.5 text-sm text-zinc-500 hover:text-ink"
          >
            <LogOut size={14} /> Sign out
          </button>
        )}
      </div>
    </div>
  );
}
