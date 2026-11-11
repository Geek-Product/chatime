import { useQuery } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';
import { api } from '../lib/api';
import type { Member, Message } from '../lib/types';

export function ThreadPanel({
  parentMessage,
  meId,
  meUsername,
  members,
  knownUsernames,
  onClose,
  channelId,
  channelName,
  onSend,
  onEdit,
  onDelete,
  onToggleReaction,
}: {
  parentMessage: Message;
  meId: string;
  meUsername: string;
  members: Member[];
  knownUsernames: Set<string>;
  channelId: string;
  channelName: string;
  onClose: () => void;
  onSend: (content: string, attachmentIds: string[], parentId: string) => Promise<void>;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleReaction: (id: string, emoji: string) => Promise<void>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['thread', channelId, parentMessage.id],
    queryFn: () => api.get<{ replies: Message[] }>(`/messages/${parentMessage.id}/replies`),
  });

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-white">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">Thread</h2>
          <p className="text-xs text-zinc-500">
            #{channelName} · {data?.replies.length ?? 0} {data?.replies.length === 1 ? 'reply' : 'replies'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1.5 text-zinc-500 hover:bg-hover" aria-label="Close thread">
          <X size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-2">
        <MessageItem
          message={parentMessage}
          meId={meId}
          meUsername={meUsername}
          compactGrouped={false}
          knownUsernames={knownUsernames}
          onEdit={onEdit}
          onDelete={onDelete}
          onToggleReaction={onToggleReaction}
          onOpenThread={() => {}}
          onJumpTo={null}
          highlighted={false}
        />
        <div className="my-2 flex items-center gap-3 px-5">
          <span className="text-xs font-semibold text-zinc-500">
            {data?.replies.length ?? 0} replies
          </span>
          <div className="h-px flex-1 bg-line" />
        </div>
        {isLoading && (
          <div className="flex justify-center py-6 text-zinc-400">
            <Loader2 className="animate-spin" size={18} />
          </div>
        )}
        {data?.replies.map((r) => (
          <MessageItem
            key={r.id}
            message={r}
            meId={meId}
            meUsername={meUsername}
            compactGrouped={false}
            knownUsernames={knownUsernames}
            onEdit={onEdit}
            onDelete={onDelete}
            onToggleReaction={onToggleReaction}
            onOpenThread={() => {}}
            onJumpTo={null}
            highlighted={false}
          />
        ))}
      </div>

      <Composer
        placeholder="Reply…"
        members={members}
        autoFocus
        compact
        onSend={(content, attachmentIds) => onSend(content, attachmentIds, parentMessage.id)}
      />
    </aside>
  );
}
