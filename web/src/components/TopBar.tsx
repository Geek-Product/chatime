import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Hash, Lock, Pencil, UserRound } from 'lucide-react';
import { Avatar } from './Avatar';
import { api } from '../lib/api';
import { useDismiss } from '../lib/useDismiss';
import { plainText } from './MessageText';
import type { Channel, SavedMention } from '../lib/types';

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function TopBar({
  channel,
  dm,
  membersOpen,
  onToggleMembers,
  onOpenMention,
  onOpenProfile,
  onEditChannel,
}: {
  channel: Channel | null;
  dm?: { id: string; displayName: string; username: string; avatarColor: string; online: boolean } | null;
  membersOpen: boolean;
  onToggleMembers: () => void;
  onOpenMention: (m: SavedMention) => void;
  onOpenProfile?: (dm: { id: string; displayName: string; username: string; avatarColor: string; online: boolean }) => void;
  onEditChannel?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['notifications', 'mentions'],
    queryFn: () => api.get<{ mentions: SavedMention[] }>('/notifications/mentions'),
  });
  const mentions = data?.mentions ?? [];
  const unreadCount = mentions.filter((m) => !m.readAt).length;

  useDismiss(box, open, () => setOpen(false));

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center justify-between border-b border-line bg-white px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-[15px] font-bold">
        {channel ? (
          <>
            {channel.isPrivate ? <Lock size={14} className="text-zinc-500" /> : <Hash size={14} className="text-zinc-500" />}
            <span className="truncate">{channel.name}</span>
            {channel.topic && (
              <span className="ml-3 hidden truncate border-l border-line pl-3 text-sm font-normal text-zinc-500 lg:inline">
                {channel.topic}
              </span>
            )}
            {onEditChannel && (
              <button
                type="button"
                onClick={onEditChannel}
                className="ml-2 flex shrink-0 items-center gap-1 rounded border border-line px-2 py-0.5 text-xs font-semibold text-zinc-600 hover:bg-hover hover:text-ink"
                aria-label="Edit channel"
                title="Edit channel name, topic and members"
              >
                <Pencil size={12} /> Edit
              </button>
            )}
          </>
        ) : dm ? (
          <>
            <button
              type="button"
              onClick={() => onOpenProfile?.(dm)}
              className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-hover"
              title={`View ${dm.displayName}'s profile`}
            >
              {dm.avatarColor ? (
                <Avatar name={dm.displayName} color={dm.avatarColor} size={22} online={dm.online} />
              ) : (
                <UserRound size={14} className="text-zinc-500" />
              )}
              <span className="truncate">{dm.displayName}</span>
            </button>
            <span className="ml-1 border-l border-line pl-3 text-sm font-normal">
              <span className={dm.online ? 'text-emerald-700' : 'text-zinc-600'}>{dm.online ? 'Active' : 'Offline'}</span>
              <span className="ml-2 text-zinc-500">@{dm.username}</span>
            </span>
          </>
        ) : (
          <span>Mentions & activity</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <div className="relative" ref={box}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="relative rounded p-2 text-zinc-600 hover:bg-hover"
            aria-label="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {open && (
            <div className="absolute right-0 z-40 mt-1 w-96 overflow-hidden rounded-xl border border-line bg-white shadow-2xl">
              <div className="border-b border-line px-4 py-3">
                <h3 className="font-bold">Mentions</h3>
                <p className="text-xs text-zinc-500">Recent messages that mention you</p>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {mentions.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-500">No mentions yet.</p>}
                {mentions.map((m) => (
                  <button
                    key={m.messageId}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpenMention(m);
                    }}
                    className={`flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-hover ${m.readAt ? '' : 'bg-amber-50/50'}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${m.readAt ? 'bg-transparent' : 'bg-red-500'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        <b>{m.authorName}</b> <span className="text-zinc-500">in</span>{' '}
                        <b>{m.channelId === null ? 'a direct message' : `#${m.channelName}`}</b>
                        <span className="ml-2 text-xs text-zinc-400">{relative(m.createdAt)}</span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-sm text-zinc-600">{plainText(m.content)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {!dm && (
          <button
            type="button"
            onClick={onToggleMembers}
            className={`rounded p-2 hover:bg-hover ${membersOpen ? 'text-purple-800' : 'text-zinc-600'}`}
            aria-label="Toggle members"
          >
            <UserRound size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
