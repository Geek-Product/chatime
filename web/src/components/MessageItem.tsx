import { useRef, useState, type ReactNode } from 'react';
import { useOnline } from '../lib/usePresence';
import { useProfile } from '../lib/profile';
import { useDismiss } from '../lib/useDismiss';
import { MessageSquare, MoreHorizontal, Pencil, SmilePlus, Trash2, X } from 'lucide-react';
import { Avatar } from './Avatar';
import { Attachments } from './AttachmentView';
import { MessageText, plainText } from './MessageText';
import type { Message } from '../lib/types';

const QUICK_EMOJI = ['👍', '🎉', '❤️', '😄', '👀', '🚀'];

export function timeLabel(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

const compact = (text: string) => plainText(text).slice(0, 120);

/** Author avatar/name that opens the profile card. */
function NameButton({
  author,
  shape,
  children,
}: {
  author: Message['author'];
  shape?: 'avatar';
  children: ReactNode;
}) {
  const { openProfile, workspaceId } = useProfile();
  const online = useOnline(author.id);
  return (
    <button
      type="button"
      onClick={() => {
        if (!workspaceId) return;
        openProfile({
          userId: author.id,
          workspaceId,
          displayName: author.displayName,
          username: author.username,
          avatarColor: author.avatarColor,
          online,
        });
      }}
      className={shape ? 'shrink-0 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent' : 'text-left hover:underline focus:outline-none focus-visible:underline'}
      title={`View ${author.displayName}'s profile`}
    >
      {children}
    </button>
  );
}

export function MessageItem({
  message,
  meId,
  meUsername,
  compactGrouped,
  knownUsernames,
  onEdit,
  onDelete,
  onToggleReaction,
  onOpenThread,
  onJumpTo,
  highlighted,
  onMentionClick,
}: {
  message: Message;
  meId: string;
  meUsername: string;
  compactGrouped: boolean;
  knownUsernames: Set<string>;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleReaction: (id: string, emoji: string) => Promise<void>;
  onOpenThread: (id: string) => void;
  onJumpTo: ((id: string) => void) | null;
  highlighted: boolean;
  onMentionClick?: (username: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [showEmoji, setShowEmoji] = useState(false);
  const emojiRef = useRef<HTMLDivElement>(null);
  useDismiss(emojiRef, showEmoji, () => setShowEmoji(false));
  const mine = message.author.id === meId;
  const deleted = Boolean(message.deletedAt);
  const mentioned = message.mentionsMe || (message.mentionUserIds?.includes(meId) ?? false);

  if (deleted) {
    return (
      <div className="px-5 py-1 text-sm text-zinc-400 italic">{message.parentId ? '' : 'This message was deleted.'}</div>
    );
  }

  return (
    <div
      id={`m-${message.id}`}
      className={`group relative px-5 ${compactGrouped ? 'py-0.5' : 'mt-2 py-1'} ${
        highlighted ? 'bg-amber-50/80' : mentioned ? 'bg-amber-50/60' : 'hover:bg-hover'
      } ${mentioned || highlighted ? 'border-l-4 border-amber-400 pl-4' : ''}`}
    >
      <div className="flex gap-2.5">
        {compactGrouped ? (
          <div className="w-9 shrink-0 pt-1 text-right text-[11px] leading-5 text-zinc-400 opacity-0 group-hover:opacity-100">
            {timeLabel(message.createdAt)}
          </div>
        ) : (
          <NameButton author={message.author} shape="avatar">
            <Avatar name={message.author.displayName} color={message.author.avatarColor} />
          </NameButton>
        )}

        <div className="min-w-0 flex-1">
          {!compactGrouped && (
            <div className="flex items-baseline gap-2">
              <NameButton author={message.author}>
                <span className="font-bold text-[15px]">{message.author.displayName}</span>
              </NameButton>
              <span className="text-xs text-zinc-500">{timeLabel(message.createdAt)}</span>
            </div>
          )}

          {message.parentPreview && (
            <button
              type="button"
              onClick={() => onJumpTo?.(message.parentPreview!.id)}
              className="mt-0.5 mb-1 flex max-w-full items-center gap-1.5 truncate rounded border-l-2 border-zinc-300 pl-2 text-left text-xs text-zinc-500 hover:text-zinc-700"
            >
              <span className="font-semibold">{message.parentPreview.authorName}</span>
              <span className="truncate">{compact(message.parentPreview.content)}</span>
            </button>
          )}

          {editing ? (
            <div className="mt-1">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (draft.trim()) void onEdit(message.id, draft.trim()).then(() => setEditing(false));
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
                className="w-full rounded-md border border-zinc-400 p-2 text-[15px] outline-none"
                rows={2}
              />
              <div className="mt-1 flex gap-2 text-xs">
                <button
                  type="button"
                  className="rounded bg-emerald-600 px-2 py-1 font-bold text-white"
                  onClick={() => draft.trim() && void onEdit(message.id, draft.trim()).then(() => setEditing(false))}
                >
                  Save
                </button>
                <button type="button" className="rounded border border-line px-2 py-1" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <MessageText
              content={message.content}
              me={meUsername}
              knownUsernames={knownUsernames}
              onMentionClick={onMentionClick}
            />
          )}

          {message.editedAt && !editing && <span className="ml-1 text-[11px] text-zinc-400">(edited)</span>}

          <Attachments attachments={message.attachments} />

          {message.reactions.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  type="button"
                  title={r.users.map((u) => `@${u}`).join(', ')}
                  onClick={() => void onToggleReaction(message.id, r.emoji)}
                  className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                    r.reactedByMe ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-zinc-200 bg-zinc-50 hover:border-zinc-400'
                  }`}
                >
                  <span>{r.emoji}</span>
                  <span className="font-semibold">{r.count}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowEmoji((v) => !v)}
                className="flex items-center rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 hover:border-zinc-400"
              >
                <SmilePlus size={12} />
              </button>
            </div>
          )}

          {!message.parentId && !message.directConversationId && message.replyCount > 0 && (
            <button
              type="button"
              onClick={() => onOpenThread(message.id)}
              className="mt-1 flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
            >
              <MessageSquare size={13} />
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>

      {/* hover toolbar */}
      <div className="absolute -top-4 right-5 z-10 hidden items-center gap-0.5 rounded-md border border-line bg-white p-0.5 shadow-md group-hover:flex">
        {QUICK_EMOJI.slice(0, 3).map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-hover"
            onClick={() => void onToggleReaction(message.id, emoji)}
            aria-label={`React ${emoji}`}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className="rounded px-1.5 py-1 text-zinc-600 hover:bg-hover"
          onClick={() => setShowEmoji(true)}
          aria-label="Add reaction"
        >
          <SmilePlus size={15} />
        </button>
        {!message.parentId && !message.directConversationId && (
          <button
            type="button"
            className="rounded px-1.5 py-1 text-zinc-600 hover:bg-hover"
            onClick={() => onOpenThread(message.id)}
            aria-label="Reply in thread"
          >
            <MessageSquare size={15} />
          </button>
        )}
        {mine && (
          <>
            <button
              type="button"
              className="rounded px-1.5 py-1 text-zinc-600 hover:bg-hover"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
              aria-label="Edit message"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-1 text-zinc-600 hover:bg-hover"
              onClick={() => void onDelete(message.id)}
              aria-label="Delete message"
            >
              <Trash2 size={15} />
            </button>
          </>
        )}
        <MoreHorizontal size={15} className="mx-1 text-zinc-300" />
      </div>

      {showEmoji && (
        <div ref={emojiRef} className="absolute right-5 z-20 mt-1 flex items-center gap-1 rounded-lg border border-line bg-white p-1.5 shadow-xl">
          {QUICK_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded px-1.5 py-1 text-lg hover:bg-hover"
              onClick={() => {
                void onToggleReaction(message.id, emoji);
                setShowEmoji(false);
              }}
            >
              {emoji}
            </button>
          ))}
          <button type="button" className="px-1 text-zinc-400" onClick={() => setShowEmoji(false)}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
