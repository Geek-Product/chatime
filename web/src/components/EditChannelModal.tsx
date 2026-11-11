import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, Lock, UserMinus, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar } from './Avatar';
import { MemberPicker } from './MemberPicker';
import { WebhooksSection } from './WebhooksSection';
import { api } from '../lib/api';
import type { Channel, ChannelPerson, Member } from '../lib/types';

type MembersResponse = { members: ChannelPerson[] };

/** Edit a channel: name, topic, public/private visibility and who is in it. */
export function EditChannelModal({
  channel,
  members,
  meId,
  isAdmin = false,
  onClose,
}: {
  channel: Channel;
  /** Workspace members, offered for invitation. */
  members: Member[];
  meId: string;
  /** Owners/admins also manage the channel's incoming webhooks. */
  isAdmin?: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [error, setError] = useState<string | null>(null);
  const [toInvite, setToInvite] = useState<Set<string>>(new Set());
  const [isPrivate, setIsPrivate] = useState(channel.isPrivate);

  const { data } = useQuery({
    queryKey: ['channel-members', channel.id],
    queryFn: () => api.get<MembersResponse>(`/channels/${channel.id}/members`),
  });
  const channelMembers = data?.members ?? [];
  const channelMemberIds = useMemo(() => new Set(channelMembers.map((m) => m.id)), [channelMembers]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<{ channel: Channel }>(`/channels/${channel.id}`, {
        name,
        topic: topic.trim() || null,
        ...(isPrivate !== channel.isPrivate ? { isPrivate } : {}),
      }),
    onSuccess: ({ channel: updated }) => {
      qc.setQueryData<{ channels: Channel[] }>(['channels', channel.workspaceId], (prev) =>
        prev && { channels: prev.channels.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)) });
      // Visibility changed: the channel moves between sidebar sections, and unread counts follow.
      if (updated.isPrivate !== channel.isPrivate) {
        qc.invalidateQueries({ queryKey: ['channels', channel.workspaceId] });
        qc.invalidateQueries({ queryKey: ['unread'] });
      }
    },
  });

  const invite = useMutation({
    mutationFn: (userIds: string[]) =>
      api.post<{ added: string[] }>(`/channels/${channel.id}/members`, { userIds }),
    onSuccess: ({ added }) => {
      qc.invalidateQueries({ queryKey: ['channel-members', channel.id] });
      qc.invalidateQueries({ queryKey: ['channels', channel.workspaceId] });
      setToInvite(new Set());
      toast.success(added.length === 1 ? '1 person added to the channel' : `${added.length} people added to the channel`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api.del(`/channels/${channel.id}/members/${userId}`),
    onSuccess: (_r, userId) => {
      qc.setQueryData<MembersResponse>(['channel-members', channel.id], (prev) =>
        prev && { members: prev.members.filter((m) => m.id !== userId) });
      qc.invalidateQueries({ queryKey: ['channels', channel.workspaceId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const busy = save.isPending || invite.isPending || remove.isPending;
  const dirty = name !== channel.name || topic.trim() !== (channel.topic ?? '') || isPrivate !== channel.isPrivate;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[a-z0-9][a-z0-9-_]{1,79}$/.test(name)) {
      setError('Use 2-80 lowercase letters, numbers, - or _');
      return;
    }
    try {
      if (dirty) await save.mutateAsync();
      if (toInvite.size > 0) await invite.mutateAsync([...toInvite]);
      toast.success('Channel updated');
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit channel"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-300 bg-white p-6 text-ink shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink">Edit #{channel.name}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Rename it, update the topic, switch it between public and private, or invite more people.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <label className="mt-4 block text-sm font-bold text-ink">
          Name
          <div className="mt-1 flex items-center rounded-md border border-zinc-400 bg-white px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
            <Hash size={15} className="text-zinc-500" />
            <input
              className="w-full bg-transparent px-1 py-2 text-sm text-ink outline-none"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              aria-label="Channel name"
            />
          </div>
        </label>

        <label className="mt-3 block text-sm font-bold text-ink">
          Topic
          <input
            className="mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
            value={topic}
            maxLength={250}
            placeholder="What is this channel about?"
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Channel topic"
          />
        </label>

        <label className="mt-4 flex items-start gap-2 rounded-md border border-zinc-200 bg-panel p-3 text-sm text-ink">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5" />
          <span>
            <Lock size={13} className="mr-1 inline" />
            <b>Make private</b>
            <span className="block text-xs text-zinc-600">
              {isPrivate
                ? 'Only the people currently in this channel can see it. Unchecked, the whole workspace can find and join it.'
                : 'Turning this on hides the channel from everyone in the workspace who is not already a member.'}
            </span>
          </span>
        </label>

        <div className="mt-5">
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <UserPlus size={14} /> Invite people
          </p>
          <div className="mt-2">
            <MemberPicker
              people={members}
              selected={toInvite}
              excludedIds={channelMemberIds}
              onToggle={(id) =>
                setToInvite((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })}
            />
          </div>
          <button
            type="button"
            disabled={toInvite.size === 0 || invite.isPending}
            onClick={() => invite.mutate([...toInvite])}
            className="mt-2 rounded-md bg-purple-800 px-3 py-1.5 text-sm font-bold text-white hover:bg-purple-900 disabled:opacity-50"
          >
            {invite.isPending ? 'Adding…' : `Add ${toInvite.size || ''} to channel`.replace('  ', ' ')}
          </button>
        </div>

        <div className="mt-5">
          <p className="text-sm font-bold text-ink">Members — {channelMembers.length || channel.memberCount}</p>
          <ul className="mt-2 divide-y divide-line rounded-md border border-line" aria-label="Channel members">
            {channelMembers.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <Avatar name={m.displayName} color={m.avatarColor} size={22} />
                <span className="truncate font-semibold">{m.displayName}</span>
                <span className="truncate text-xs text-zinc-500">@{m.username}</span>
                {m.id === meId ? (
                  <span className="ml-auto text-[11px] font-semibold text-zinc-500">you</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => remove.mutate(m.id)}
                    disabled={busy}
                    aria-label={`Remove ${m.displayName} from channel`}
                    className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <UserMinus size={12} /> Remove
                  </button>
                )}
              </li>
            ))}
            {channelMembers.length === 0 && <li className="px-3 py-2 text-xs text-zinc-500">Loading members…</li>}
          </ul>
        </div>

        {isAdmin && <WebhooksSection channelId={channel.id} workspaceId={channel.workspaceId} />}

        {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-400 bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-hover">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-purple-800 px-4 py-2 text-sm font-bold text-white hover:bg-purple-900 disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      </form>
    </div>
  );
}
