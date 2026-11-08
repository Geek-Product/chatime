import { useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { MessageItem, dayLabel } from './MessageItem';
import { Avatar } from './Avatar';
import type { Message } from '../lib/types';

export interface HeaderInfo {
  kind: 'channel' | 'dm';
  name: string;
  subtitle?: string | null;
  avatar?: { name: string; color: string; online?: boolean };
}

interface Props {
  messages: Message[];
  hasMore: boolean;
  loadingOlder: boolean;
  header: HeaderInfo;
  meId: string;
  meUsername: string;
  knownUsernames: Set<string>;
  focusMessageId: string | null;
  jumpMessageId: string | null;
  onLoadOlder: () => void;
  onEdit: (id: string, content: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleReaction: (id: string, emoji: string) => Promise<void>;
  onOpenThread: (id: string) => void;
  onMentionClick?: (username: string) => void;
  composer: React.ReactNode;
}

const GROUP_WINDOW_MS = 5 * 60_000;

export function MessageList(props: Props) {
  const { messages, hasMore, loadingOlder, focusMessageId, jumpMessageId } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastChannel = useRef<string | null>(null);
  const loadedIds = useRef<string[]>([]);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // Empty lists still need a stable identity so the grouped composer isn't remounted.
    const key = props.header.kind === 'dm' ? `dm:${props.header.name}` : `ch:${props.header.name}`;
    const channelChanged = lastChannel.current !== key;
    if (channelChanged) {
      lastChannel.current = key;
      loadedIds.current = messages.map((m) => m.id);
      requestAnimationFrame(() => scrollToBottom());
      return;
    }
    // Prepending history keeps the newest id, so check for ids that weren't loaded before.
    const prevIds = new Set(loadedIds.current);
    const appended = prevIds.size === 0
      ? messages.length > 0
      : messages.some((m) => !prevIds.has(m.id));
    loadedIds.current = messages.map((m) => m.id);
    if (atBottom.current) requestAnimationFrame(() => scrollToBottom());
    // Only growth at the end is news for the reader; loaded history and read-state updates are not.
    else if (appended) setShowJump(true);
  }, [messages]);

  // Preserve scroll position when older messages are prepended
  const prevHeight = useRef(0);
  useEffect(() => {
    if (!loadingOlder && prevHeight.current) {
      const el = scroller.current;
      if (el) el.scrollTop += el.scrollHeight - prevHeight.current;
    }
  }, [loadingOlder]);

  // Spread the target across the viewport instead of centering it, so unread text after it is visible.
  const targetEl = (id: string) => document.getElementById(`m-${id}`) ?? document.getElementById(`jump-${id}`);
  const scrollTargetIntoView = (id: string) => {
    const el = scroller.current;
    const target = targetEl(id);
    if (!el || !target) return;
    const elRect = el.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    el.scrollTop += targetRect.top - elRect.top - 60;
  };

  useEffect(() => {
    if (focusMessageId) scrollTargetIntoView(focusMessageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMessageId, messages.length]);

  useEffect(() => {
    if (!focusMessageId) return;
    const el = document.getElementById(`m-${focusMessageId}`);
    if (el) {
      el.classList.add('ring-2', 'ring-purple-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-purple-400'), 2500);
    }
  }, [focusMessageId, messages.length]);

  const jumpIndex = jumpMessageId ? messages.findIndex((m) => m.id === jumpMessageId) : -1;

  function loadOlder() {
    prevHeight.current = scroller.current?.scrollHeight ?? 0;
    props.onLoadOlder();
  }

  const known = props.knownUsernames;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          if (atBottom.current) setShowJump(false);
          if (el.scrollTop < 80 && hasMore && !loadingOlder) loadOlder();
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="border-b border-line px-5 pt-10 pb-4">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {props.header.avatar && (
              <Avatar name={props.header.avatar.name} color={props.header.avatar.color} size={28} online={props.header.avatar.online} />
            )}
            <span>{props.header.kind === 'dm' ? props.header.name : `#${props.header.name}`}</span>
          </h1>
          {props.header.subtitle && <p className="mt-1 text-sm text-zinc-500">{props.header.subtitle}</p>}
        </div>

        {hasMore && (
          <div className="py-3 text-center text-xs text-zinc-500">
            {loadingOlder ? 'Loading earlier messages…' : 'Scroll up for earlier messages'}
          </div>
        )}

        <div className="pb-4">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const grouped = !showDay
              && !!prev
              && prev.author.id === m.author.id
              && !m.parentPreview
              && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="sticky top-0 z-[5] my-3 flex items-center gap-3 px-5">
                    <div className="h-px flex-1 bg-line" />
                    <span className="rounded-full border border-line bg-white px-3 py-0.5 text-xs font-bold">{dayLabel(m.createdAt)}</span>
                    <div className="h-px flex-1 bg-line" />
                  </div>
                )}
                {i === jumpIndex && (
                  <div className="my-2 flex items-center gap-3 px-5" id={`jump-${m.id}`}>
                    <div className="h-px flex-1 bg-red-400" />
                    <span className="rounded-full bg-red-500 px-2.5 py-0.5 text-[11px] font-bold text-white">New</span>
                    <div className="h-px flex-1 bg-red-400" />
                  </div>
                )}
                <MessageItem
                  message={m}
                  meId={props.meId}
                  meUsername={props.meUsername}
                  compactGrouped={grouped}
                  knownUsernames={known}
                  onEdit={props.onEdit}
                  onDelete={props.onDelete}
                  onToggleReaction={props.onToggleReaction}
                  onOpenThread={props.onOpenThread}
                  onJumpTo={null}
                  highlighted={m.id === focusMessageId}
                  onMentionClick={props.onMentionClick}
                />
              </div>
            );
          })}
          {messages.length === 0 && (
            <div className="px-5 py-16 text-center text-sm text-zinc-500">
              This is the very beginning of{' '}
              <b>{props.header.kind === 'dm' ? `your conversation with ${props.header.name}` : `#${props.header.name}`}</b>. Say hi! 👋
            </div>
          )}
        </div>
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="absolute right-6 bottom-36 flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-purple-800 shadow-md hover:bg-hover"
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      )}

      {props.composer}
    </div>
  );
}
