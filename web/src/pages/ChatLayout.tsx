import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Sidebar } from '../components/Sidebar';
import { TopBar } from '../components/TopBar';
import { MessageList, type HeaderInfo } from '../components/MessageList';
import { ThreadPanel } from '../components/ThreadPanel';
import { Composer } from '../components/Composer';
import { SettingsModal } from '../components/SettingsModal';
import { EditChannelModal } from '../components/EditChannelModal';
import { UserProfileCard } from '../components/UserProfileCard';
import { Avatar } from '../components/Avatar';
import MentionsView from './MentionsView';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { useRealtime } from '../lib/useRealtime';
import { setReplyCount } from '../lib/replyCounting';
import { signupBadgeKey } from '../components/SignupsDialog';
import { useOnlineUsers } from '../lib/usePresence';
import { useProfile } from '../lib/profile';
import { useProfileSettingsRequest } from '../lib/profile-settings';
import type {
  Channel,
  Conversation,
  Member,
  MentionNotification,
  Message,
  SavedMention,
  UnreadResponse,
  Workspace,
} from '../lib/types';

interface MessagesPage {
  messages: Message[];
  hasMore: boolean;
  focusId?: string;
}

/** A page loaded around a specific message (notification links, jump to unread). */
interface HistoryPage extends MessagesPage {
  channelId: string | null;
  directConversationId: string | null;
}

const PAGE_SIZE = 40;
const DM_PAGE_SIZE = 30;

const threadKey = (channelId: string, parentId: string) => ['thread', channelId, parentId] as const;
const threadOf = (message: Message) => (message.channelId ? threadKey(message.channelId, message.id) : null);

export default function ChatLayout({ isAdmin = false }: { isAdmin?: boolean }) {
  const { user, logout } = useAuth();
  const me = user!;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { workspaceId, channelId, conversationId } = useParams();
  const online = useOnlineUsers();
  const [searchParams, setSearchParams] = useSearchParams();
  const threadId = searchParams.get('thread');
  const focusId = searchParams.get('m');
  const jumpId = searchParams.get('jump');

  const [membersOpen, setMembersOpen] = useState(true);
  const [settingsTab, setSettingsTab] = useState<'preferences' | 'profile' | 'account' | null>(null);
  const profileSettingsRequests = useProfileSettingsRequest();
  const [editChannelOpen, setEditChannelOpen] = useState(false);
  const [pendingPage, setPendingPage] = useState<{ key: string; messages: Message[]; hasMore: boolean; focusId?: string } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const setLocationParams = useCallback(
    (messageId: string) => setSearchParams({ m: messageId }),
    [setSearchParams],
  );

  const closeThread = useCallback(
    () => setSearchParams((p) => { p.delete('thread'); return p; }, { replace: true }),
    [setSearchParams],
  );

  // Owner/admin anywhere may create workspaces (the API enforces the same rule).
  const { data: adminData } = useQuery({
    queryKey: ['access-workspaces'],
    queryFn: () => api.get<{ workspaces: unknown[]; pending: number }>('/access/workspaces'),
  });
  const canCreateWorkspace = (adminData?.workspaces.length ?? 0) > 0;

  const { data: wsData, isLoading: wsLoading } = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api.get<{ workspaces: Workspace[] }>('/workspaces'),
  });
  const workspaces = wsData?.workspaces ?? [];

  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? workspaces[0],
    [workspaces, workspaceId],
  );
  const isMentionsView = !channelId && !conversationId;

  useEffect(() => {
    // Pending accounts are handled by App, which shows the waiting screen instead of this layout.
    if (!wsLoading && !workspace && me.status !== 'pending') navigate('/login', { replace: true });
    if (workspace && !workspaceId) navigate(`/w/${workspace.id}`, { replace: true });
  }, [wsLoading, workspace, workspaceId, navigate]);

  const { data: channelData } = useQuery({
    queryKey: ['channels', workspace?.id],
    queryFn: () => api.get<{ channels: Channel[] }>(`/workspaces/${workspace!.id}/channels`),
    enabled: Boolean(workspace),
  });
  const channels = channelData?.channels ?? [];

  const channel = useMemo(
    () => (workspaceId && channelId ? channels.find((c) => c.id === channelId) ?? null : null),
    [channels, workspaceId, channelId],
  );

  const { data: memberData } = useQuery({
    queryKey: ['members', workspace?.id],
    queryFn: () => api.get<{ members: Member[] }>(`/workspaces/${workspace!.id}/members`),
    enabled: Boolean(workspace),
  });
  const members = memberData?.members ?? [];
  const knownUsernames = useMemo(() => new Set(members.map((m) => m.username.toLowerCase())), [members]);

  const { data: conversationData } = useQuery({
    queryKey: ['conversations', workspace?.id],
    queryFn: () => api.get<{ conversations: Conversation[] }>(`/workspaces/${workspace!.id}/conversations`),
    enabled: Boolean(workspace),
  });
  const conversations = conversationData?.conversations ?? [];
  const conversation = useMemo(
    () => (conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null),
    [conversations, conversationId],
  );

  const { openProfile } = useProfile();

  const openMemberProfile = useCallback(
    (username: string) => {
      const m = members.find((x) => x.username.toLowerCase() === username.toLowerCase());
      if (!m || !workspace) return;
      openProfile({
        userId: m.id,
        workspaceId: workspace.id,
        displayName: m.displayName,
        username: m.username,
        avatarColor: m.avatarColor,
        online: online.has(m.id),
      });
    },
    [members, online, openProfile, workspace],
  );

  const { data: unreadData } = useQuery({
    queryKey: ['unread'],
    queryFn: () => api.get<UnreadResponse>('/unread'),
    enabled: Boolean(workspace),
  });
  const unread = unreadData?.channels ?? [];
  const unreadDms = unreadData?.conversations ?? [];

  // Channel and DM threads share this component; only one of them is ever active.
  const activeId = conversation ? conversation.id : (channel?.id ?? null);

  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', activeId],
    queryFn: async () => {
      const page = conversation
        ? await api.get<MessagesPage>(`/dms/${conversation.id}/messages?limit=${DM_PAGE_SIZE}`)
        : await api.get<MessagesPage>(`/channels/${channel!.id}/messages?limit=${PAGE_SIZE}`);
      setPendingPage((prev) => (prev?.key === (conversation?.id ?? channel?.id) ? prev : null));
      return page;
    },
    enabled: Boolean(conversation || channel),
  });

  const usingPending = Boolean(activeId && pendingPage?.key === activeId);
  const messages = usingPending ? pendingPage!.messages : messagesData?.messages ?? [];
  const hasMore = usingPending ? pendingPage!.hasMore : (messagesData?.hasMore ?? false);
  /** The user's latest message here, recalled into the composer with ↑ to be edited in place. */
  const lastOwnMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.author.id === me.id && !m.deletedAt && m.content) return { id: m.id, content: m.content };
    }
    return null;
  }, [messages, me.id]);
  /** Message to scroll to: the pending page target (jump/around), else a `?m=` link that is in the list. */
  const targetFocus = jumpId ?? pendingPage?.focusId ?? messagesData?.focusId ?? focusId;

  const threadMessage = useMemo(() => {
    if (!threadId || conversation) return null;
    return messages.find((m) => m.id === threadId) ?? null;
  }, [messages, threadId, conversation]);

  const header = useMemo<HeaderInfo | null>(() => {
    if (conversation) {
      return {
        kind: 'dm',
        name: conversation.other.displayName,
        subtitle: `This is the beginning of your direct message history with @${conversation.other.username}.`,
        avatar: { name: conversation.other.displayName, color: conversation.other.avatarColor, online: online.has(conversation.other.id) },
      };
    }
    if (channel) {
      return { kind: 'channel', name: channel.name, subtitle: channel.topic };
    }
    return null;
  }, [conversation, channel, online]);

  // ---- side effects: title badge, mark read, stale ids ----
  const totalUnread = unreadData?.unread ?? 0;
  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) Team Chat` : 'Team Chat';
  }, [totalUnread]);

  const markChannelRead = useCallback(() => {
    if (!channel) return;
    void api.post(`/channels/${channel.id}/read`);
    qc.setQueryData<UnreadResponse>(['unread'], (prev) => {
      if (!prev) return prev;
      const cur = prev.channels.find((c) => c.channelId === channel.id);
      return {
        ...prev,
        channels: prev.channels.map((c) => (c.channelId === channel.id ? { ...c, unread: 0, unreadMentions: 0 } : c)),
        unread: Math.max(0, prev.unread - (cur?.unread ?? 0)),
      };
    });
  }, [channel, qc]);

  const markConversationRead = useCallback(() => {
    if (!conversation) return;
    void api.post(`/dms/${conversation.id}/read`);
    qc.setQueryData<UnreadResponse>(['unread'], (prev) => {
      if (!prev) return prev;
      const cur = prev.conversations.find((c) => c.conversationId === conversation.id);
      return {
        ...prev,
        conversations: prev.conversations.map((c) => (c.conversationId === conversation.id ? { ...c, unread: 0 } : c)),
        unread: Math.max(0, prev.unread - (cur?.unread ?? 0)),
      };
    });
  }, [conversation, qc]);

  // Opening a chat with unread messages keeps the unread state (and jump points) until the
  // "Jump to new messages" line is passed, so the badges stay visible while reading.
  const unreadCur = channel ? unreadData?.channels.find((c) => c.channelId === channel.id)?.unread ?? 0 : 0;
  const unreadDmCur = conversation
    ? unreadData?.conversations.find((c) => c.conversationId === conversation.id)?.unread ?? 0
    : 0;
  const hasUnreadHere = unreadCur + unreadDmCur > 0;
  // Without an explicit notice, an unread chat starts at its first unread message.
  const jumpNotice = Boolean(jumpId || focusId);
  const jumpTarget = useMemo(() => {
    if (jumpId) return jumpId;
    if (focusId) return null;
    if (!hasUnreadHere) return null;
    return channel
      ? unreadData?.jump.find((j) => j.channelId === channel.id)?.messageId ?? null
      : conversation
        ? unreadData?.jump.find((j) => j.conversationId === conversation.id)?.messageId ?? null
        : null;
  }, [jumpId, focusId, hasUnreadHere, channel, conversation, unreadData]);

  useEffect(() => {
    if (messagesLoading || (hasUnreadHere && jumpTarget && !jumpNotice)) return;
    markChannelRead();
    markConversationRead();
  }, [messagesLoading, hasUnreadHere, jumpTarget, jumpNotice, markChannelRead, markConversationRead]);

  useEffect(() => {
    if (channelData && channelId && !channelData.channels.some((c) => c.id === channelId) && workspace) {
      const first = channelData.channels[0];
      navigate(first ? `/w/${workspace.id}/c/${first.id}` : `/w/${workspace.id}`, { replace: true });
    }
  }, [channelData, channelId, workspace, navigate]);

  useEffect(() => {
    if (conversationData && conversationId && !conversationData.conversations.some((c) => c.id === conversationId) && workspace) {
      navigate(`/w/${workspace.id}`, { replace: true });
    }
  }, [conversationData, conversationId, workspace, navigate]);

  const loadedIds = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);

  // Deep link into history: load the page around the target message when it isn't in the list.
  const targetInList = Boolean(focusId && messagesData?.messages.some((m) => m.id === focusId));
  const [aroundKey, setAroundKey] = useState<string | null>(null);
  useEffect(() => {
    if (focusId && !targetInList) setAroundKey(`${channel?.id ?? conversation?.id}:${focusId}`);
    else setAroundKey(null);
  }, [focusId, targetInList, channel?.id, conversation?.id]);

  useEffect(() => {
    if (!aroundKey) return;
    const [listKey, messageId] = aroundKey.split(':');
    const endpoint = conversation ? `/dms/${conversation.id}/history` : `/channels/${channel?.id}/history`;
    let cancelled = false;
    api.get<HistoryPage>(`${endpoint}?around=${messageId}`)
      .then((page) => {
        if (!cancelled) setPendingPage({ key: listKey, messages: page.messages, hasMore: page.hasMore, focusId: messageId });
      })
      .catch((e: Error) => toast.error(e.message));
    return () => {
      cancelled = true;
    };
  }, [aroundKey, conversation, channel]);

  const jumpLoaded = useRef<string | null>(null);
  const aroundLoadedForUnread = useRef<string | null>(null);
  useEffect(() => {
    if (!jumpTarget || !jumpId) return;
    const key = `${activeId}:${jumpId}`;
    if (jumpLoaded.current === key) return;
    jumpLoaded.current = key;
    if (messagesData?.messages.some((m) => m.id === jumpId)) {
      setPendingPage({ key: activeId!, messages: messagesData.messages, hasMore: messagesData.hasMore, focusId: jumpId });
      return;
    }
    const endpoint = conversation ? `/dms/${conversation.id}/history` : `/channels/${channel?.id}/history`;
    let cancelled = false;
    api.get<HistoryPage>(`${endpoint}?around=${jumpId}`)
      .then((page) => {
        if (cancelled) return;
        setPendingPage({ key: activeId!, messages: page.messages, hasMore: page.hasMore, focusId: jumpId });
        aroundLoadedForUnread.current = key;
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [jumpId, jumpTarget, activeId, messagesData, conversation, channel]);

  // Message links can point at a reply; open its channel thread then.
  const threadLookup = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId || !activeId || !channel || messagesLoading || threadId || targetInList) return;
    if (threadLookup.current === `${activeId}:${focusId}`) return;
    threadLookup.current = `${activeId}:${focusId}`;
    api.get<{ message: Message }>(`/messages/${focusId}`)
      .then(({ message }) => {
        if (message.parentId && message.channelId === channel.id) setSearchParams({ thread: message.parentId });
      })
      .catch(() => {});
  }, [focusId, activeId, channel, messagesLoading, threadId, targetInList, setSearchParams]);

  // "Jump to new": show the first unread message, then mark the chat read once it is visible.
  const jumpedTo = useRef<string | null>(null);
  useEffect(() => {
    if (!jumpTarget || !activeId || messagesLoading) return;
    const key = `${activeId}:${jumpTarget}`;
    if (jumpedTo.current === key || aroundLoadedForUnread.current === `${activeId}:${jumpId}`) return;
    jumpedTo.current = key;
    const endpoint = conversation
      ? `/dms/${conversation.id}/history`
      : channel
        ? `/channels/${channel.id}/history`
        : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      timer = setTimeout(() => {
        markChannelRead();
        markConversationRead();
      }, 1200);
    };
    if (loadedIds.has(jumpTarget)) {
      setPendingPage((prev) => (prev?.key === activeId ? { ...prev, focusId: jumpTarget } : prev));
      finish();
      return () => clearTimeout(timer);
    }
    if (!endpoint) return;
    let cancelled = false;
    api.get<HistoryPage>(`${endpoint}?around=${jumpTarget}`)
      .then((page) => {
        if (cancelled) return;
        setPendingPage({ key: activeId, messages: page.messages, hasMore: page.hasMore, focusId: jumpTarget });
        finish();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jumpTarget, activeId, messagesLoading, loadedIds, conversation, channel, markChannelRead, markConversationRead]);

  // A message link is consumed once shown; the unread jump point stays until read.
  useEffect(() => {
    if (!focusId) return;
    const t = setTimeout(
      () => setSearchParams((p) => { p.delete('m'); return p; }, { replace: true }),
      2500,
    );
    return () => clearTimeout(t);
  }, [focusId, setSearchParams]);

  // ---- actions ----
  const applyReplyCount = useCallback((parentId: string, count: number) => {
    setReplyCount(qc, setPendingPage, parentId, count);
  }, [qc]);

  const sendMutation = useMutation({
    mutationFn: (body: {
      channelId?: string;
      conversationId?: string;
      content: string;
      attachmentIds?: string[];
      parentId?: string;
    }) =>
      api.post<{ message: Message; parentReplyCount?: number }>('/messages', body),
    onSuccess: ({ message, parentReplyCount }) => {
      const targetId = message.directConversationId ?? message.channelId;
      if (message.parentId) {
        const key = threadOf(message);
        if (key) {
          qc.setQueryData<{ replies: Message[] }>(key, (prev) =>
            prev && !prev.replies.some((m) => m.id === message.id)
              ? { replies: [...prev.replies, message] }
              : prev);
        }
        // Apply the server's total; the realtime echo carries the same value.
        if (parentReplyCount !== undefined) applyReplyCount(message.parentId, parentReplyCount);
      } else {
        qc.setQueryData<MessagesPage>(['messages', targetId], (prev) =>
          prev && !prev.messages.some((m) => m.id === message.id)
            ? { ...prev, messages: [...prev.messages, message] }
            : prev);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch<{ message: Message }>(`/messages/${id}`, { content }),
    onSuccess: ({ message }) => {
      qc.setQueriesData<MessagesPage>({ queryKey: ['messages'] }, (prev) =>
        prev && { ...prev, messages: prev.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m)) });
      qc.setQueriesData<{ replies: Message[] }>({ queryKey: ['thread'] }, (prev) =>
        prev && { replies: prev.replies.map((m) => (m.id === message.id ? { ...m, ...message } : m)) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean; parentReplyCount?: number }>(`/messages/${id}`),
    onSuccess: (result, id) => {
      if (threadId === id) closeThread();
      const reply = qc.getQueriesData<{ replies: Message[] }>({ queryKey: ['thread'] })
        .flatMap(([, page]) => page?.replies ?? [])
        .find((m) => m.id === id);
      if (reply?.parentId && result.parentReplyCount !== undefined) {
        applyReplyCount(reply.parentId, result.parentReplyCount);
      }
      const deletedAt = new Date().toISOString();
      qc.setQueriesData<MessagesPage>({ queryKey: ['messages'] }, (prev) =>
        prev && { ...prev, messages: prev.messages.map((m) => (m.id === id ? { ...m, deletedAt, content: '' } : m)) });
      qc.setQueriesData<{ replies: Message[] }>({ queryKey: ['thread'] }, (prev) =>
        prev && { replies: prev.replies.filter((m) => m.id !== id) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reactionMutation = useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) =>
      api.post<{ reactions: Message['reactions'] }>(`/messages/${id}/reactions`, { emoji }),
    onSuccess: ({ reactions }, { id }) => {
      qc.setQueriesData<MessagesPage>({ queryKey: ['messages'] }, (prev) =>
        prev && { ...prev, messages: prev.messages.map((m) => (m.id === id ? { ...m, reactions } : m)) });
      qc.setQueriesData<{ replies: Message[] }>({ queryKey: ['thread'] }, (prev) =>
        prev && { replies: prev.replies.map((m) => (m.id === id ? { ...m, reactions } : m)) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const loadOlder = useCallback(async () => {
    if (!activeId || messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    const endpoint = conversation ? `/dms/${conversation.id}/messages` : `/channels/${channel!.id}/messages`;
    try {
      const page = await api.get<MessagesPage>(
        `${endpoint}?limit=${PAGE_SIZE}&before=${encodeURIComponent(messages[0].createdAt)}`,
      );
      setPendingPage({
        key: activeId,
        messages: [...page.messages, ...messages],
        hasMore: page.hasMore,
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }, [activeId, conversation, channel, messages, loadingOlder]);

  const openMention = useCallback(
    (n: { messageId: string; channelId: string | null; conversationId?: string | null; workspaceId: string }) => {
      void api.post('/notifications/read', { messageIds: [n.messageId] }).then(() =>
        qc.invalidateQueries({ queryKey: ['notifications', 'mentions'] }));
      if (n.channelId === null) {
        const dmId = n.conversationId ?? null;
        if (dmId && dmId === conversation?.id) return setLocationParams(n.messageId);
        navigate(dmId ? `/w/${n.workspaceId}/d/${dmId}?m=${n.messageId}` : `/w/${n.workspaceId}`);
        return;
      }
      if (n.channelId === channel?.id) setLocationParams(n.messageId);
      else navigate(`/w/${n.workspaceId}/c/${n.channelId}?m=${n.messageId}`);
    },
    [setLocationParams, channel?.id, conversation?.id, navigate, qc],
  );

  /** Toast "View": the notification already carries the workspace/channel/DM, so navigate immediately. */
  const openNotification = useCallback(
    (n: MentionNotification) => openMention(n),
    [openMention],
  );

  const onMention = useCallback((n: MentionNotification) => {
    qc.setQueryData<UnreadResponse>(['unread'], (prev) => prev && { ...prev, mentions: n.unreadMentions });
  }, [qc]);

  const onChannelCreated = useCallback((c: Channel) => {
    qc.setQueryData<{ channels: Channel[] }>(['channels', c.workspaceId], (prev) =>
      prev && prev.channels.some((x) => x.id === c.id) ? prev : { channels: [...(prev?.channels ?? []), c] });
  }, [qc]);

  const onChannelUpdated = useCallback((c: Channel) => {
    qc.setQueryData<{ channels: Channel[] }>(['channels', c.workspaceId], (prev) =>
      prev && { channels: prev.channels.map((x) => (x.id === c.id ? { ...x, ...c } : x)) });
    if (!c.isPrivate) qc.invalidateQueries({ queryKey: ['unread'] });
  }, [qc]);

  const onConversationCreated = useCallback((c: Conversation) => {
    qc.setQueryData<{ conversations: Conversation[] }>(['conversations', c.workspaceId], (prev) =>
      prev && !prev.conversations.some((x) => x.id === c.id)
        ? { conversations: [c, ...prev.conversations] }
        : prev);
  }, [qc]);

  useRealtime({
    meId: me.id,
    activeChannelId: channel?.id ?? null,
    activeConversationId: conversation?.id ?? null,
    onMention,
    onOpenNotification: openNotification,
    onChannelCreated,
    onChannelUpdated,
    onConversationCreated,
    onReplyCount: applyReplyCount,
    onAccessChanged: () => {
      // A sign-up was accepted or declined: refresh the queue badge and the member list.
      qc.invalidateQueries({ queryKey: signupBadgeKey });
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      qc.invalidateQueries({ queryKey: ['members'] });
    },
  });

  // "Edit profile" on your own profile card opens settings straight on the Profile tab.
  const lastProfileRequest = useRef(profileSettingsRequests);
  useEffect(() => {
    if (profileSettingsRequests !== lastProfileRequest.current) {
      lastProfileRequest.current = profileSettingsRequests;
      setSettingsTab('profile');
    }
  }, [profileSettingsRequests]);

  const lastWorkspace = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (workspace?.id !== lastWorkspace.current) {
      lastWorkspace.current = workspace?.id;
      qc.invalidateQueries({ queryKey: ['unread'] });
    }
  }, [workspace?.id, qc]);

  if (wsLoading || !workspace) {
    return (
      <div className="flex h-full items-center justify-center text-zinc-400">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        workspaces={workspaces}
        workspace={workspace}
        channels={channels}
        conversations={conversations}
        unread={unread}
        unreadDms={unreadDms}
        members={members}
        me={me}
        online={online}
        activeChannelId={channel?.id ?? null}
        activeConversationId={conversation?.id ?? null}
        onOpenSettings={() => setSettingsTab('preferences')}
        onLogout={() => void logout()}
        isAdmin={isAdmin}
        canCreateWorkspace={canCreateWorkspace}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <TopBar
          channel={channel}
          dm={conversation
            ? {
                id: conversation.other.id,
                displayName: conversation.other.displayName,
                username: conversation.other.username,
                avatarColor: conversation.other.avatarColor,
                online: online.has(conversation.other.id),
              }
            : null}
          membersOpen={membersOpen}
          onToggleMembers={() => setMembersOpen((v) => !v)}
          onOpenMention={(m: SavedMention) => openMention(m)}
          onEditChannel={channel ? () => setEditChannelOpen(true) : undefined}
          onOpenProfile={(d) =>
            openProfile({
              userId: d.id,
              workspaceId: workspace.id,
              displayName: d.displayName,
              username: d.username,
              avatarColor: d.avatarColor,
              online: d.online,
            })
          }
        />

        <div className="flex min-h-0 flex-1">
          {isMentionsView ? (
            <MentionsView
              onOpen={openMention}
              meUsername={me.username}
              knownUsernames={knownUsernames}
            />
          ) : !header || !activeId ? (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              {conversationId ? 'Select a person to start a conversation.' : 'Select a channel to start chatting.'}
            </div>
          ) : (
            <MessageList
              messages={messages}
              hasMore={hasMore}
              loadingOlder={loadingOlder || messagesLoading}
              header={header}
              meId={me.id}
              meUsername={me.username}
              knownUsernames={knownUsernames}
              focusMessageId={targetFocus}
              jumpMessageId={jumpTarget}
              onLoadOlder={() => void loadOlder()}
              onEdit={(id, content) => editMutation.mutateAsync({ id, content }).then(() => {})}
              onDelete={(id) => deleteMutation.mutateAsync(id).then(() => {})}
              onToggleReaction={(id, emoji) => reactionMutation.mutateAsync({ id, emoji }).then(() => {})}
              onOpenThread={(id) => setSearchParams({ thread: id })}
              onMentionClick={openMemberProfile}
              composer={
                <Composer
                  placeholder={conversation ? `Message ${conversation.other.displayName}` : `Message #${channel!.name}`}
                  members={members}
                  lastOwnMessage={lastOwnMessage}
                  onEdit={(id, content) => editMutation.mutateAsync({ id, content }).then(() => {})}
                  onSend={async (content, attachmentIds) => {
                    await sendMutation.mutateAsync(
                      conversation
                        ? { conversationId: conversation.id, content, attachmentIds }
                        : { channelId: channel!.id, content, attachmentIds },
                    );
                  }}
                />
              }
            />
          )}

          {threadMessage && channel && (
            <ThreadPanel
              parentMessage={threadMessage}
              meId={me.id}
              meUsername={me.username}
              members={members}
              knownUsernames={knownUsernames}
              channelId={channel.id}
              channelName={channel.name}
              onClose={closeThread}
              onSend={async (content, attachmentIds, parentId) => {
                await sendMutation.mutateAsync({ channelId: channel.id, content, attachmentIds, parentId });
              }}
              onEdit={(id, content) => editMutation.mutateAsync({ id, content }).then(() => {})}
              onDelete={(id) => deleteMutation.mutateAsync(id).then(() => {})}
              onToggleReaction={(id, emoji) => reactionMutation.mutateAsync({ id, emoji }).then(() => {})}
            />
          )}

          {membersOpen && !isMentionsView && !conversation && (
            <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-line bg-white xl:block">
              <div className="px-4 pt-4 pb-2 text-xs font-bold tracking-wide text-zinc-500 uppercase">Members — {members.length}</div>
              {members.map((m) => (
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
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-hover"
                  title={`View ${m.displayName}'s profile`}
                >
                  <Avatar name={m.displayName} color={m.avatarColor} size={26} online={online.has(m.id)} />
                  <span className="truncate text-sm">{m.displayName}</span>
                  {m.role === 'owner' && <span className="ml-auto text-[10px] font-semibold text-amber-600">owner</span>}
                </button>
              ))}
              <div className="mx-3 my-2 h-px bg-line" />
              <div className="px-4 pb-4 text-xs text-zinc-400">
                Mention someone by typing <b>@username</b> in any message.
                <div className="mt-3 space-y-1">
                  {members.filter((m) => m.id !== me.id).slice(0, 3).map((m) => (
                    <div key={m.id}>@{m.username} — {m.displayName}</div>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>

      {settingsTab && (
        <SettingsModal
          me={me}
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
          onLogout={() => void logout()}
        />
      )}
      {editChannelOpen && channel && (
        <EditChannelModal
          channel={channel}
          members={members}
          meId={me.id}
          isAdmin={isAdmin}
          onClose={() => setEditChannelOpen(false)}
        />
      )}
      <UserProfileCard />
    </div>
  );
}
