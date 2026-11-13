export type AccessStatus = 'approved' | 'pending' | 'declined';

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  /** Job title, e.g. PM, Backend, Fullstack. */
  title?: string | null;
  avatarColor: string;
  /** Set by the API: accounts wait for an admin to accept their sign-up. */
  status?: AccessStatus;
  /** Webhook/integration authors: rendered like people but cannot sign in. */
  isBot?: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
  ownerId: string;
}

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  topic: string | null;
  isPrivate: boolean;
  memberCount: number;
  isMember: boolean;
  lastReadAt?: string | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  users: string[];
}

export interface Conversation {
  id: string;
  workspaceId: string;
  other: Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor'>;
  lastMessageAt: string | null;
  lastPreview: string | null;
  lastAuthorIsMe: boolean;
  createdAt: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  isImage: boolean;
}

export interface Message {
  id: string;
  channelId: string | null;
  directConversationId?: string | null;
  parentId: string | null;
  content: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor'>;
  reactions: Reaction[];
  attachments: Attachment[];
  mentionUsernames: string[];
  mentionUserIds?: string[];
  mentionsMe: boolean;
  replyCount: number;
  parentPreview: { id: string; authorName: string; content: string } | null;
}

export interface Member extends Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor' | 'title'> {
  role: 'owner' | 'admin' | 'member';
  /** Only returned to workspace owners and admins. */
  email?: string | null;
}

/** A person shown in channel member pickers (workspace or channel membership). */
export type ChannelPerson = Pick<User, 'id' | 'username' | 'displayName' | 'avatarColor'>;

export interface UnreadChannel {
  channelId: string;
  unread: number;
  unreadMentions: number;
}

export interface UnreadConversation {
  conversationId: string;
  unread: number;
}

export interface UnreadJumpPoint {
  channelId: string | null;
  conversationId: string | null;
  messageId: string;
}

export interface UnreadResponse {
  channels: UnreadChannel[];
  conversations: UnreadConversation[];
  jump: UnreadJumpPoint[];
  unread: number;
  mentions: number;
}

export interface MentionNotification {
  kind: 'mention' | 'webhook';
  messageId: string;
  channelId: string | null;
  conversationId?: string | null;
  workspaceId: string;
  channelName: string | null;
  authorName: string;
  snippet: string;
  at: string;
  unreadMentions: number;
}

export interface Webhook {
  id: string;
  channelId: string;
  workspaceId: string;
  name: string;
  template: string | null;
  notify: boolean;
  disabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** Returned once, on create or rotate: the only time the secret URL is shown. */
export type WebhookWithUrl = Webhook & { url: string };

export interface SavedMention {
  messageId: string;
  channelName: string | null;
  channelId: string | null;
  workspaceId: string;
  authorName: string;
  content: string;
  createdAt: string;
  readAt: string | null;
}

export type ServerEvent =
  | { type: 'hello'; userId: string; workspaceIds: string[]; unread: { unread: number; mentions: number }; online: string[] }
  | { type: 'message.created'; message: Message; parentReplyCount?: number }
  | { type: 'message.updated'; message: Message }
  | { type: 'message.deleted'; id: string; channelId: string | null; conversationId?: string | null; parentId: string | null; parentReplyCount?: number }
  | { type: 'reaction.updated'; messageId: string; reactions: Reaction[] }
  | { type: 'channel.created'; channel: Channel }
  | { type: 'channel.updated'; channel: Channel }
  | { type: 'user.updated'; user: Pick<User, 'id' | 'username' | 'displayName' | 'title' | 'avatarColor'> }
  | { type: 'conversation.created'; conversation: Conversation }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'notification'; notification: MentionNotification }
  | { type: 'access.changed'; status: 'approved' | 'declined'; workspaceId: string }
  | { type: 'member.role_changed'; workspaceId: string; userId: string; role: 'owner' | 'admin' | 'member' }
  | { type: 'ping' }
  | { type: 'pong' };
