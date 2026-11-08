import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, ChevronDown, Hash, Lock, Pencil, Plus, Settings, UserPlus, X, UserCheck } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Avatar } from './Avatar';
import { MemberPicker } from './MemberPicker';
import { SignupsDialog, usePendingSignups } from './SignupsDialog';
import { api } from '../lib/api';
import { useProfile } from '../lib/profile';
import { socket } from '../lib/socket';
import { useTheme } from '../lib/theme';
import { useDismiss } from '../lib/useDismiss';
import type { Channel, Conversation, Member, UnreadChannel, UnreadConversation, User, Workspace } from '../lib/types';

function CreateChannelModal({
  workspaceId,
  members,
  meId,
  onClose,
}: {
  workspaceId: string;
  members: Member[];
  meId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [invites, setInvites] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ channel: Channel }>(`/workspaces/${workspaceId}/channels`, {
      name,
      topic: topic || undefined,
      isPrivate,
      memberIds: [...invites],
    }),
    onSuccess: ({ channel }) => {
      qc.invalidateQueries({ queryKey: ['channels', workspaceId] });
      navigate(`/w/${workspaceId}/c/${channel.id}`);
      if (invites.size) toast.success(`Invited ${invites.size} ${invites.size === 1 ? 'person' : 'people'} to #${channel.name}`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[a-z0-9][a-z0-9-_]{1,79}$/.test(name)) {
      setError('Use 2-80 lowercase letters, numbers, - or _');
      return;
    }
    create.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-zinc-300 bg-white p-6 text-ink shadow-2xl"
        role="dialog"
        aria-label="Create a channel"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold text-ink">Create a channel</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          Channels are where your team communicates. They're best when organized around a topic.
        </p>

        <label className="mt-4 block text-sm font-bold text-ink">
          Name
          <div className="mt-1 flex items-center rounded-md border border-zinc-400 bg-white px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30">
            <Hash size={15} className="text-zinc-500" />
            <input
              autoFocus
              className="w-full bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-zinc-400"
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
              placeholder="e.g. plan-budget"
            />
          </div>
        </label>

        <label className="mt-3 block text-sm font-bold text-ink">
          Topic (optional)
          <input
            className="mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={250}
          />
        </label>

        <label className="mt-4 flex items-start gap-2 rounded-md border border-zinc-200 bg-panel p-3 text-sm text-ink">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5" />
          <span>
            <Lock size={13} className="mr-1 inline" />
            <b>Make private</b>
            <span className="block text-xs text-zinc-600">Private channels are only visible to people you invite.</span>
          </span>
        </label>

        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <UserPlus size={14} /> Invite people{' '}
            <span className="text-xs font-normal text-zinc-500">{isPrivate ? '(they get access to this private channel)' : '(they join when the channel is created)'}</span>
          </p>
          <div className="mt-2">
            <MemberPicker
              people={members.filter((m) => m.id !== meId)}
              selected={invites}
              onToggle={(id) =>
                setInvites((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })}
            />
          </div>
        </div>

        {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-400 bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name || create.isPending}
            className="rounded-md bg-purple-800 px-4 py-2 text-sm font-bold text-white hover:bg-purple-900 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<{ workspace: Workspace }>('/workspaces', { name: name.trim() }),
    onSuccess: ({ workspace }) => {
      qc.setQueryData<{ workspaces: Workspace[] }>(['workspaces'], (prev) =>
        prev && !prev.workspaces.some((w) => w.id === workspace.id)
          ? { workspaces: [...prev.workspaces, workspace] }
          : prev);
      qc.invalidateQueries({ queryKey: ['access-workspaces'] });
      // The socket learns its workspaces at handshake time; without this the new workspace
      // would not receive realtime messages until the next reconnect.
      socket.restart();
      navigate(`/w/${workspace.id}`);
      toast.success(`Created ${workspace.name}`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) return setError('Use at least 2 characters');
          create.mutate();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Create a workspace"
        className="w-full max-w-md rounded-xl border border-zinc-300 bg-white p-6 text-ink shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink">Create a workspace</h2>
            <p className="mt-1 text-sm text-zinc-600">
              A new space with its own channels and members. You'll be its owner and can approve sign-ups.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label className="mt-4 block text-sm font-bold text-ink">
          Workspace name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="e.g. Design Guild"
            className="mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
            aria-label="Workspace name"
          />
        </label>
        {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-400 bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-hover">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="rounded-md bg-purple-800 px-4 py-2 text-sm font-bold text-white hover:bg-purple-900 disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create workspace'}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditWorkspaceModal({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: () => api.patch<{ workspace: Workspace }>(`/workspaces/${workspace.id}`, { name: name.trim() }),
    onSuccess: ({ workspace: updated }) => {
      qc.setQueryData<{ workspaces: Workspace[] }>(['workspaces'], (prev) =>
        prev && { workspaces: prev.workspaces.map((w) => (w.id === updated.id ? { ...w, name: updated.name } : w)) });
      toast.success('Workspace updated');
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]" onMouseDown={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim().length < 2) return setError('Use at least 2 characters');
          setError(null);
          save.mutate();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Edit workspace"
        className="w-full max-w-md rounded-xl border border-zinc-300 bg-white p-6 text-ink shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-ink">Edit workspace</h2>
            <p className="mt-1 text-sm text-zinc-600">Rename how this workspace appears to everyone in it.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <label className="mt-4 block text-sm font-bold text-ink">
          Workspace name
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="mt-1 w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </label>
        {error && <p className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="rounded-md border border-zinc-400 bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-hover">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || name.trim() === workspace.name || save.isPending}
            className="rounded-md bg-purple-800 px-4 py-2 text-sm font-bold text-white hover:bg-purple-900 disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewDmModal({
  workspaceId,
  me,
  members,
  conversations,
  online,
  onClose,
}: {
  workspaceId: string;
  me: User;
  members: Member[];
  conversations: Conversation[];
  online: ReadonlySet<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const open = useMutation({
    mutationFn: (body: { userId: string }) =>
      api.post<{ conversation: Conversation }>(`/workspaces/${workspaceId}/conversations`, body),
    onSuccess: ({ conversation }) => {
      qc.setQueryData<{ conversations: Conversation[] }>(['conversations', workspaceId], (prev) =>
        prev && !prev.conversations.some((c) => c.id === conversation.id)
          ? { conversations: [conversation, ...prev.conversations] }
          : prev);
      navigate(`/w/${workspaceId}/d/${conversation.id}`);
      onClose();
    },
  });

  const q = query.trim().toLowerCase();
  const people = members
    .filter((m) => m.id !== me.id)
    .filter((m) => !q || m.username.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q));
  const existing = new Set(conversations.map((c) => c.other.id));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="New direct message"
        onMouseDown={(e) => {
          e.stopPropagation();
          // Clicks (or Enter on a focused button) inside the card must not submit anything by accident.
          if (e.target === e.currentTarget) e.preventDefault();
        }}
        className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-300 bg-white text-ink shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-ink">New direct message</h2>
            <p className="text-xs text-zinc-600">Pick a person to start a private 1:1 chat.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-600 hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or @username"
            className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-zinc-400 focus:border-accent focus:ring-2 focus:ring-accent/30"
            aria-label="Search people"
          />
        </div>
        <div className="max-h-80 overflow-y-auto pb-2">
          {people.length === 0 && <p className="px-5 py-6 text-center text-sm font-medium text-zinc-600">No one matches.</p>}
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              disabled={open.isPending}
              onClick={() => open.mutate({ userId: m.id })}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink hover:bg-hover disabled:opacity-50"
            >
              <Avatar name={m.displayName} color={m.avatarColor} size={24} online={online.has(m.id)} />
              <span className="font-bold">{m.displayName}</span>
              <span className="truncate text-zinc-600">@{m.username}</span>
              {existing.has(m.id) && (
                <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">open chat</span>
              )}
            </button>
          ))}
        </div>
        {open.error && (
          <p className="m-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {(open.error as Error).message}
          </p>
        )}
      </div>
    </div>
  );
}

export function Sidebar({
  workspaces,
  workspace,
  channels,
  conversations,
  unread,
  unreadDms,
  members,
  me,
  online,
  activeChannelId,
  activeConversationId,
  onOpenSettings,
  onLogout,
  isAdmin,
  canCreateWorkspace = false,
}: {
  workspaces: Workspace[];
  workspace: Workspace;
  channels: Channel[];
  conversations: Conversation[];
  unread: UnreadChannel[];
  unreadDms: UnreadConversation[];
  members: Member[];
  me: User;
  online: ReadonlySet<string>;
  activeChannelId: string | null;
  activeConversationId: string | null;
  onOpenSettings: () => void;
  onLogout: () => void;
  isAdmin: boolean;
  /** Owner/admin of at least one workspace. */
  canCreateWorkspace?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { color, textColor } = useTheme();
  const { openProfile } = useProfile();
  const [showCreate, setShowCreate] = useState(false);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [showSignups, setShowSignups] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showEditWorkspace, setShowEditWorkspace] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  useDismiss(switcherRef, showSwitcher, () => setShowSwitcher(false));
  const pendingSignups = usePendingSignups(workspace.id, isAdmin).data?.users.length ?? 0;

  const { data: mentions } = useQuery({
    queryKey: ['notifications', 'mentions'],
    queryFn: () => api.get<{ mentions: { readAt: string | null }[] }>('/notifications/mentions'),
  });
  const unreadMentions = mentions?.mentions.filter((m) => !m.readAt).length ?? 0;

  const join = useMutation({
    mutationFn: (channelId: string) => api.post(`/channels/${channelId}/join`),
    onSuccess: (_data, channelId) => {
      qc.invalidateQueries({ queryKey: ['channels', workspace.id] });
      navigate(`/w/${workspace.id}/c/${channelId}`);
    },
  });

  const [showNewDm, setShowNewDm] = useState(false);
  const unreadFor = (id: string) => unread.find((u) => u.channelId === id);
  const DmRow = ({ c }: { c: Conversation }) => {
    const isActive = c.id === activeConversationId;
    const u = unreadDms.find((x) => x.conversationId === c.id)?.unread ?? 0;
    const isOnline = online.has(c.other.id);
    return (
      <button
        type="button"
        onClick={() => navigate(`/w/${workspace.id}/d/${c.id}`)}
        className={clsx(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm',
          isActive ? 'bg-white/90 font-bold text-purple-900' : 'text-white/70 hover:bg-white/10 hover:text-white',
          !isActive && u > 0 ? 'font-bold text-white' : '',
        )}
        title={c.lastPreview ?? `Start a conversation with ${c.other.displayName}`}
      >
        <Avatar name={c.other.displayName} color={c.other.avatarColor} size={18} online={isOnline} />
        <span className={clsx('truncate', !isActive && (isOnline ? 'text-white' : 'text-white/60'))}>{c.other.displayName}</span>
        {u > 0 && (
          <span className="ml-auto rounded-full bg-white/20 px-1.5 text-[10px] font-bold text-white">{u}</span>
        )}
      </button>
    );
  };
  const publicChannels = channels.filter((c) => !c.isPrivate);
  const privateChannels = channels.filter((c) => c.isPrivate);

  const ChannelRow = ({ ch }: { ch: Channel }) => {
    const u = unreadFor(ch.id);
    const isActive = ch.id === activeChannelId;
    return (
      <button
        type="button"
        onClick={() => navigate(`/w/${workspace.id}/c/${ch.id}`)}
        className={clsx(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm',
          isActive ? 'bg-white/90 font-bold text-purple-900' : 'text-white/70 hover:bg-white/10 hover:text-white',
          !isActive && u?.unread ? 'font-bold text-white' : '',
        )}
      >
        {ch.isPrivate ? <Lock size={13} className="shrink-0" /> : <Hash size={13} className="shrink-0 opacity-70" />}
        <span className="truncate">{ch.name}</span>
        {!ch.isMember && !ch.isPrivate && (
          <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); join.mutate(ch.id); }} onKeyDown={(e) => e.key === 'Enter' && join.mutate(ch.id)} className="ml-auto shrink-0 rounded border border-white/40 px-1.5 text-[10px] font-bold uppercase hover:bg-white/15">
            Join
          </span>
        )}
        {u?.unread ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {u.unreadMentions > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
                {u.unreadMentions}
              </span>
            )}
            <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-bold text-white">{u.unread}</span>
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <aside
      data-testid="sidebar"
      className="sidebar-root flex w-64 shrink-0 flex-col"
      style={{ '--sb-bg': color, '--sb-text': textColor } as CSSProperties}
    >
      <div className="relative border-b border-white/15" ref={switcherRef}>
        <div className="flex w-full items-center gap-2 px-4 py-3.5 hover:bg-white/10">
          <button
            type="button"
            onClick={() => setShowSwitcher((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            aria-expanded={showSwitcher}
            aria-label="Switch workspace"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/20 font-bold">
              {workspace.name[0]}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate font-bold">{workspace.name}</span>
              <span className="block truncate text-xs text-white/60">{me.username}</span>
            </span>
            <ChevronDown size={16} className="opacity-70" />
          </button>
          <button
            type="button"
            onClick={() => openProfile({ userId: me.id, workspaceId: workspace.id, displayName: me.displayName, username: me.username, avatarColor: me.avatarColor, online: true })}
            className="rounded px-1 py-0.5 text-[11px] font-semibold text-white/70 hover:bg-white/15 hover:text-white"
            title="View your profile"
          >
            Profile
          </button>
        </div>
        {showSwitcher && (
          <div className="absolute top-full right-2 left-2 z-30 mt-1 rounded-lg bg-white p-1 text-ink shadow-xl">
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => {
                  navigate(`/w/${w.id}`);
                  setShowSwitcher(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-hover"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-white" style={{ background: color }}>
                  {w.name[0]}
                </span>
                <span className="flex-1 truncate">{w.name}</span>
                {w.id === workspace.id && <span className="text-xs text-emerald-600">✓</span>}
              </button>
            ))}
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setShowSwitcher(false);
                  setShowEditWorkspace(true);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-semibold text-ink hover:bg-hover"
              >
                <Pencil size={14} /> Edit workspace
              </button>
            )}
            {canCreateWorkspace && (
              <button
                type="button"
                onClick={() => {
                  setShowSwitcher(false);
                  setShowCreateWorkspace(true);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm font-semibold text-purple-800 hover:bg-hover"
              >
                <Plus size={14} /> New workspace
              </button>
            )}
            <div className="my-1 h-px bg-line" />
            <button
              type="button"
              onClick={onLogout}
              className="w-full rounded px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <button
          type="button"
          onClick={() => navigate(`/w/${workspace.id}/mentions`)}
          className={clsx(
            'mb-2 flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm',
            location.pathname.endsWith('/mentions') ? 'bg-white/90 font-bold text-purple-900' : 'text-white/70 hover:bg-white/10',
          )}
        >
          <AtSign size={14} />
          <span>Mentions & activity</span>
          {unreadMentions > 0 && (
            <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{unreadMentions}</span>
          )}
        </button>

        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowSignups(true)}
            className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          >
            <UserCheck size={14} />
            <span>Sign-ups</span>
            {pendingSignups > 0 && (
              <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-black">{pendingSignups}</span>
            )}
          </button>
        )}

        <div className="mt-3 mb-1 flex items-center justify-between px-2 text-[13px] font-semibold text-white/60">
          <span>Channels</span>
          <button type="button" onClick={() => setShowCreate(true)} className="rounded p-0.5 hover:bg-white/15" aria-label="Create channel">
            <Plus size={15} />
          </button>
        </div>
        {publicChannels.map((ch) => <ChannelRow key={ch.id} ch={ch} />)}
        {privateChannels.length > 0 && (
          <>
            <div className="mt-3 mb-1 px-2 text-[13px] font-semibold text-white/60">Private</div>
            {privateChannels.map((ch) => <ChannelRow key={ch.id} ch={ch} />)}
          </>
        )}

        <div className="mt-3 mb-1 flex items-center justify-between px-2 text-[13px] font-semibold text-white/60">
          <span>Direct messages</span>
          <button type="button" onClick={() => setShowNewDm(true)} className="rounded p-0.5 hover:bg-white/15" aria-label="New direct message">
            <Plus size={15} />
          </button>
        </div>
        {conversations.length === 0 && (
          <button
            type="button"
            onClick={() => setShowNewDm(true)}
            className="w-full rounded-md px-2 py-1 text-left text-xs text-white/50 hover:bg-white/10 hover:text-white"
          >
            Start a 1:1 chat…
          </button>
        )}
        {conversations.map((c) => <DmRow key={c.id} c={c} />)}

        <button
          type="button"
          onClick={() => setShowMembers((v) => !v)}
          className="mt-4 mb-1 flex w-full items-center justify-between px-2 text-[13px] font-semibold text-white/60 hover:text-white"
        >
          <span>Members</span>
          <ChevronDown size={13} className={clsx('transition', showMembers && 'rotate-180')} />
        </button>
        {showMembers &&
          members.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() =>
                openProfile({
                  userId: m.id,
                  workspaceId: workspace.id,
                  displayName: m.displayName,
                  username: m.username,
                  avatarColor: m.avatarColor,
                  online: online.has(m.id),
                })
              }
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-white/70 hover:bg-white/10 hover:text-white"
              title={`View ${m.displayName}'s profile`}
            >
              <Avatar name={m.displayName} color={m.avatarColor} size={20} online={online.has(m.id)} />
              <span className="truncate">{m.displayName}</span>
              {m.id === me.id && <span className="text-[10px] text-white/50">you</span>}
              {m.role === 'owner' && <span className="ml-auto text-[10px] text-amber-300">owner</span>}
            </button>
          ))}
      </nav>

      {showSignups && (
        <SignupsDialog workspaceId={workspace.id} workspaceName={workspace.name} onClose={() => setShowSignups(false)} />
      )}

      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Open settings"
        className="flex items-center gap-2 border-t border-white/15 px-4 py-3 text-sm text-white/80 hover:bg-white/10"
      >
        <Avatar name={me.displayName} color={me.avatarColor} size={28} />
        <span className="truncate font-semibold">{me.displayName}</span>
        <Settings size={16} className="ml-auto" />
      </button>

      {showCreate && (
        <CreateChannelModal
          workspaceId={workspace.id}
          members={members}
          meId={me.id}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showCreateWorkspace && <CreateWorkspaceModal onClose={() => setShowCreateWorkspace(false)} />}
      {showEditWorkspace && <EditWorkspaceModal workspace={workspace} onClose={() => setShowEditWorkspace(false)} />}
      {showNewDm && (
        <NewDmModal
          workspaceId={workspace.id}
          me={me}
          members={members}
          conversations={conversations}
          online={online}
          onClose={() => setShowNewDm(false)}
        />
      )}
    </aside>
  );
}
