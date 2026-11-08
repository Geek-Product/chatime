import { useQuery } from '@tanstack/react-query';
import { AtSign, Hash, UserRound } from 'lucide-react';
import { api } from '../lib/api';
import { MessageText } from '../components/MessageText';
import type { SavedMention } from '../lib/types';

export default function MentionsView({
  onOpen,
  meUsername,
  knownUsernames,
}: {
  onOpen: (m: SavedMention) => void;
  meUsername: string;
  knownUsernames: Set<string>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'mentions'],
    queryFn: () => api.get<{ mentions: SavedMention[] }>('/notifications/mentions'),
  });

  return (
    <div className="flex-1 overflow-y-auto bg-panel">
      <div className="border-b border-line bg-white px-8 pt-10 pb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <AtSign size={22} /> Mentions & activity
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Every message where someone @mentioned you.</p>
      </div>
      <div className="mx-auto max-w-3xl px-8 py-6">
        {isLoading && <p className="text-sm text-zinc-500">Loading…</p>}
        {data?.mentions.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500">
            No mentions yet. When a teammate writes <b>@yourname</b>, it will show up here.
          </div>
        )}
        <div className="space-y-2">
          {data?.mentions.map((m) => (
            <button
              key={m.messageId}
              type="button"
              onClick={() => onOpen(m)}
              className={`block w-full rounded-lg border bg-white p-4 text-left transition hover:border-purple-300 hover:shadow-sm ${
                m.readAt ? 'border-line' : 'border-amber-300 bg-amber-50/40'
              }`}
            >
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                {m.channelId === null ? <UserRound size={12} /> : <Hash size={12} />}
                <b className="text-zinc-700">{m.channelName ?? 'direct message'}</b>
                <span>·</span>
                <span>{m.authorName}</span>
                <span>·</span>
                <span>{new Date(m.createdAt).toLocaleString()}</span>
                {!m.readAt && <span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">new</span>}
              </div>
              <div className="mt-2 text-[15px]">
                <MessageText content={m.content} me={meUsername} knownUsernames={knownUsernames} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
