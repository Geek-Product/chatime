import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { accessTokenExpiringSoon, ensureFreshAccessToken, getAccessToken, refreshSession } from './api';
import { socket } from './socket';
import { setOnlineUser } from './presence';
import { playMentionSound, playMessageSound } from './sound';
import type { Channel, ChannelPerson, Conversation, Member, MentionNotification, Message, ServerEvent, UnreadResponse } from './types';

const threadKey = (id: string, parentId: string) => ['thread', id, parentId] as const;

interface MessagesPage {
  messages: Message[];
  hasMore: boolean;
}

interface Options {
  meId: string;
  activeChannelId: string | null;
  activeConversationId: string | null;
  onMention: (n: MentionNotification) => void;
  onOpenNotification: (n: MentionNotification) => void;
  onChannelCreated: (c: Channel) => void;
  onChannelUpdated: (c: Channel) => void;
  onConversationCreated: (c: Conversation) => void;
  onAccessChanged?: (status: 'approved' | 'declined', workspaceId: string) => void;
  /** Applies a reply-count change to the visible message list, which may be a paginated snapshot. */
  onReplyCount?: (parentId: string, count: number) => void;
}

export function useRealtime({ meId, activeChannelId, activeConversationId, onMention, onOpenNotification, onChannelCreated, onChannelUpdated, onConversationCreated, onAccessChanged, onReplyCount }: Options) {
  const qc = useQueryClient();
  const activeRef = useRef(activeChannelId);
  activeRef.current = activeChannelId;
  const activeDmRef = useRef(activeConversationId);
  activeDmRef.current = activeConversationId;
  const handlers = useRef({ onMention, onOpenNotification, onChannelCreated, onChannelUpdated, onConversationCreated, onAccessChanged, onReplyCount });
  handlers.current = { onMention, onOpenNotification, onChannelCreated, onChannelUpdated, onConversationCreated, onAccessChanged, onReplyCount };

  useEffect(() => {
    const bumpUnread = (channelId: string, mentioned: boolean) => {
      qc.setQueryData<UnreadResponse>(['unread'], (prev) => {
        if (!prev) return prev;
        const channels = [...prev.channels];
        const idx = channels.findIndex((c) => c.channelId === channelId);
        if (idx === -1) channels.push({ channelId, unread: 1, unreadMentions: mentioned ? 1 : 0 });
        else channels[idx] = {
          ...channels[idx],
          unread: channels[idx].unread + 1,
          unreadMentions: channels[idx].unreadMentions + (mentioned ? 1 : 0),
        };
        return {
          ...prev,
          channels,
          unread: prev.unread + 1,
          mentions: prev.mentions + (mentioned ? 1 : 0),
        };
      });
    };

    const bumpDmUnread = (conversationId: string) => {
      qc.setQueryData<UnreadResponse>(['unread'], (prev) => {
        if (!prev) return prev;
        const conversations = [...prev.conversations];
        const idx = conversations.findIndex((c) => c.conversationId === conversationId);
        if (idx === -1) conversations.push({ conversationId, unread: 1 });
        else conversations[idx] = { ...conversations[idx], unread: conversations[idx].unread + 1 };
        return { ...prev, conversations, unread: prev.unread + 1 };
      });
    };

    // Keep the sidebar conversation row fresh (preview, ordering).
    const touchConversation = (conversationId: string, msg?: Message) => {
      qc.setQueriesData<{ conversations: Conversation[] }>({ queryKey: ['conversations'] }, (prev) => {
        if (!prev || !msg) return prev;
        const updated = prev.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessageAt: msg.createdAt,
                lastPreview: msg.deletedAt ? null : msg.content.slice(0, 120),
                lastAuthorIsMe: msg.author.id === meId,
              }
            : c);
        updated.sort((a, b) => new Date(b.lastMessageAt ?? b.createdAt).getTime() - new Date(a.lastMessageAt ?? a.createdAt).getTime());
        return { conversations: updated };
      });
    };

    const upsertInChannel = (msg: Message, mode: 'add' | 'update', parentReplyCount?: number) => {
      // Thread replies live only under the parent's thread key.
      const key = msg.directConversationId ? ['messages', msg.directConversationId] : ['messages', msg.channelId];
      if (msg.parentId) {
        const tKey = threadKey(msg.channelId!, msg.parentId);
        qc.setQueryData<{ replies: Message[] }>(tKey, (prev) => {
          if (!prev) return prev;
          if (mode === 'add') return prev.replies.some((m) => m.id === msg.id) ? prev : { replies: [...prev.replies, msg] };
          return { replies: prev.replies.map((m) => (m.id === msg.id ? msg : m)) };
        });
        if (mode === 'add' && msg.parentId && parentReplyCount !== undefined) {
          handlers.current.onReplyCount?.(msg.parentId, parentReplyCount);
        }
        return;
      }
      qc.setQueryData<MessagesPage>(key, (prev) => {
        if (!prev) return prev;
        if (mode === 'add') {
          if (prev.messages.some((m) => m.id === msg.id)) return prev;
          return { ...prev, messages: [...prev.messages, msg] };
        }
        return { ...prev, messages: prev.messages.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)) };
      });
    };

    const handler = (event: ServerEvent) => {
      switch (event.type) {
        case 'hello':
          qc.setQueryData<UnreadResponse>(['unread'], (prev) => (prev ? prev : {
            channels: [],
            conversations: [],
            jump: [],
            ...event.unread,
          }));
          for (const id of event.online) setOnlineUser(id, true);
          break;
        case 'presence':
          setOnlineUser(event.userId, event.online);
          break;
        case 'message.created': {
          const msg = event.message;
          upsertInChannel(msg, 'add', event.parentReplyCount);
          if (msg.directConversationId) touchConversation(msg.directConversationId, msg);
          if (msg.author.id === meId) return;
          qc.invalidateQueries({ queryKey: ['notifications', 'mentions'] });
          const mentioned =
            msg.mentionsMe || (msg.mentionUserIds?.includes(meId) ?? false);
          // Refetch server truth: "active" depends on the read timestamp, which is not known here.
          if (msg.directConversationId && activeDmRef.current !== msg.directConversationId) {
            bumpDmUnread(msg.directConversationId);
            qc.invalidateQueries({ queryKey: ['unread'] });
          } else if (!msg.directConversationId && activeRef.current !== msg.channelId) {
            bumpUnread(msg.channelId!, mentioned);
            qc.invalidateQueries({ queryKey: ['unread'] });
          }
          if (mentioned) playMentionSound();
          else playMessageSound();
          break;
        }
        case 'message.updated':
          upsertInChannel(event.message, 'update');
          break;
        case 'message.deleted': {
          const key = event.conversationId ? ['messages', event.conversationId] : ['messages', event.channelId];
          const deletedAt = new Date().toISOString();
          const clear = (m: Message) => (m.id === event.id ? { ...m, deletedAt, content: '' } : m);
          qc.setQueryData<MessagesPage>(key, (prev) => prev && { ...prev, messages: prev.messages.map(clear) });
          if (event.parentId && event.channelId) {
            if (event.parentReplyCount !== undefined) {
              handlers.current.onReplyCount?.(event.parentId, event.parentReplyCount);
            }
            qc.setQueryData<{ replies: Message[] }>(threadKey(event.channelId, event.parentId), (prev) =>
              prev && { replies: prev.replies.map(clear) });
          }
          break;
        }
        case 'reaction.updated':
          qc.setQueriesData<MessagesPage>({ queryKey: ['messages'] }, (prev) =>
            prev && { ...prev, messages: prev.messages.map((m) => (m.id === event.messageId ? { ...m, reactions: event.reactions } : m)) });
          qc.setQueriesData<{ replies: Message[] }>({ queryKey: ['thread'] }, (prev) =>
            prev && { replies: prev.replies.map((m) => (m.id === event.messageId ? { ...m, reactions: event.reactions } : m)) });
          break;
        case 'channel.created':
          handlers.current.onChannelCreated(event.channel);
          break;
        case 'channel.updated':
          handlers.current.onChannelUpdated(event.channel);
          break;
        case 'user.updated': {
          const u = event.user;
          qc.setQueriesData<{ members: Member[] }>({ queryKey: ['members'] }, (prev) =>
            prev && { members: prev.members.map((m) => (m.id === u.id ? { ...m, ...u } : m)) });
          qc.setQueriesData<{ members: ChannelPerson[] }>({ queryKey: ['channel-members'] }, (prev) =>
            prev && { members: prev.members.map((m) => (m.id === u.id ? { ...m, ...u } : m)) });
          qc.setQueriesData<MessagesPage>({ queryKey: ['messages'] }, (prev) =>
            prev && { ...prev, messages: prev.messages.map((m) => (m.author.id === u.id ? { ...m, author: { ...m.author, ...u } } : m)) });
          qc.setQueriesData<{ replies: Message[] }>({ queryKey: ['thread'] }, (prev) =>
            prev && { replies: prev.replies.map((m) => (m.author.id === u.id ? { ...m, author: { ...m.author, ...u } } : m)) });
          break;
        }
        case 'conversation.created':
          handlers.current.onConversationCreated(event.conversation);
          break;
        case 'access.changed':
          handlers.current.onAccessChanged?.(event.status, event.workspaceId);
          break;
        case 'notification': {
          const n = event.notification;
          if (n.kind === 'webhook') {
            // An announcement, not a mention: keep the mentions badge untouched.
            playMessageSound();
            toast(
              <span>
                <b>{n.authorName}</b> posted in <b>{n.channelName ? `#${n.channelName}` : 'a channel'}</b>
              </span>,
              {
                description: <span className="cursor-pointer">{n.snippet}</span>,
                action: { label: 'View', onClick: () => handlers.current.onOpenNotification(n) },
              },
            );
            break;
          }
          const body = (
            <span>
              <b>{n.authorName}</b> mentioned you in <b>{n.channelName ? `#${n.channelName}` : 'a direct message'}</b>
            </span>
          );
          toast(body, {
            description: <span className="cursor-pointer">{n.snippet}</span>,
            action: { label: 'View', onClick: () => handlers.current.onOpenNotification(n) },
          });
          handlers.current.onMention(n);
          qc.invalidateQueries({ queryKey: ['notifications', 'mentions'] });
          break;
        }
      }
    };

    const unsubscribe = socket.subscribe(handler);
    // The socket renews an expiring access token before each handshake.
    socket.start(getAccessToken, ensureFreshAccessToken);

    const onFocus = () => {
      if (getAccessToken() && accessTokenExpiringSoon()) void refreshSession();
    };
    window.addEventListener('focus', onFocus);

    // Keep the connection alive across remounts (channel switches, StrictMode).
    return () => {
      unsubscribe();
      window.removeEventListener('focus', onFocus);
    };
  }, [qc, meId]);
}
