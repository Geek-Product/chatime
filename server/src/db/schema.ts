import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  bigint,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const memberRole = pgEnum('member_role', ['owner', 'admin', 'member']);
export const joinRequestStatus = pgEnum('join_request_status', ['pending', 'accepted', 'declined']);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();


export const users = pgTable('users', {
  id: id(),
  email: varchar('email', { length: 255 }).notNull(),
  username: varchar('username', { length: 32 }).notNull(),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  // Bots (webhook authors) can never hold a session and store the sentinel '!bot' instead of a hash.
  passwordHash: text('password_hash').notNull(),
  avatarColor: varchar('avatar_color', { length: 16 }).notNull().default('#5865F2'),
  isBot: boolean('is_bot').notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
  uniqueIndex('users_username_unique').on(sql`lower(${t.username})`),
]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('refresh_tokens_user_idx').on(t.userId)]);

/**
 * Sign-up waiting list: every new account starts pending; a workspace admin approves or declines it.
 * `decision` stays 'pending' until an owner/admin acts.
 */
export const joinRequests = pgTable('join_requests', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  status: joinRequestStatus('status').notNull().default('pending'),
  message: varchar('message', { length: 500 }),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index('join_requests_status_idx').on(t.status, t.createdAt)]);

export const workspaces = pgTable('workspaces', {
  id: id(),
  name: varchar('name', { length: 80 }).notNull(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const workspaceMembers = pgTable('workspace_members', {
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull().default('member'),
  joinedAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.workspaceId, t.userId] }),
  index('workspace_members_user_idx').on(t.userId),
]);

export const channels = pgTable('channels', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 80 }).notNull(),
  topic: varchar('topic', { length: 250 }),
  isPrivate: boolean('is_private').notNull().default(false),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('channels_workspace_name_unique').on(t.workspaceId, sql`lower(${t.name})`)]);

export const channelMembers = pgTable('channel_members', {
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  joinedAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.channelId, t.userId] }),
  index('channel_members_user_idx').on(t.userId),
]);

/** A 1:1 conversation between two users of the same workspace. */
export const directConversations = pgTable('direct_conversations', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  // Ordered so (userA, userB) is unique per pair.
  userA: uuid('user_a').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userB: uuid('user_b').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('direct_conversations_pair_unique').on(t.workspaceId, t.userA, t.userB),
  index('direct_conversations_user_b_idx').on(t.userB),
]);

export const directConversationReads = pgTable('direct_conversation_reads', {
  conversationId: uuid('conversation_id').notNull().references(() => directConversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.userId] }),
  index('direct_conversation_reads_user_idx').on(t.userId),
]);

/** Either channelId (channel message) or directConversationId (1:1 DM) is set. */
export const messages = pgTable('messages', {
  id: id(),
  channelId: uuid('channel_id').references(() => channels.id, { onDelete: 'cascade' }),
  directConversationId: uuid('direct_conversation_id').references(() => directConversations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  parentId: uuid('parent_id'),
  content: text('content').notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('messages_channel_created_idx').on(t.channelId, t.createdAt),
  index('messages_dm_created_idx').on(t.directConversationId, t.createdAt),
  index('messages_parent_idx').on(t.parentId).where(sql`${t.parentId} is not null`),
]);

export const attachments = pgTable('attachments', {
  id: id(),
  uploaderId: uuid('uploader_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  // Storage key; generated server-side, never derived from the client filename.
  storageKey: text('storage_key').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: createdAt(),
}, (t) => [
  index('attachments_message_idx').on(t.messageId),
  index('attachments_uploader_idx').on(t.uploaderId),
]);

export const messageMentions = pgTable('message_mentions', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.userId] }),
  index('message_mentions_user_idx').on(t.userId),
]);

export const reactions = pgTable('reactions', {
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: varchar('emoji', { length: 16 }).notNull(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })]);

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
}, (t) => [index('push_subscriptions_user_idx').on(t.userId)]);

/**
 * Incoming webhook: external platforms POST to `/api/webhooks/:id/:token`. Only the token's sha256 is
 * stored; messages are authored by a bot user owned by this row.
 */
export const webhooks = pgTable('webhooks', {
  id: id(),
  channelId: uuid('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  botUserId: uuid('bot_user_id').notNull().references(() => users.id),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  name: varchar('name', { length: 80 }).notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  template: text('template'),
  notify: boolean('notify').notNull().default(false),
  disabledAt: timestamp('disabled_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  index('webhooks_channel_idx').on(t.channelId),
  index('webhooks_workspace_idx').on(t.workspaceId),
]);

/** Audit trail of deliveries, pruned to the newest 200 per webhook. */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: id(),
  webhookId: uuid('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  // No FK: messages outlive the webhook that created them.
  messageId: uuid('message_id'),
  status: varchar('status', { length: 16 }).notNull(),
  error: text('error'),
  payloadBytes: integer('payload_bytes'),
  createdAt: createdAt(),
}, (t) => [index('webhook_deliveries_webhook_idx').on(t.webhookId, t.createdAt)]);

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(workspaceMembers),
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  channels: many(channels),
  members: many(workspaceMembers),
}));

export const channelsRelations = relations(channels, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [channels.workspaceId], references: [workspaces.id] }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  author: one(users, { fields: [messages.userId], references: [users.id] }),
  reactions: many(reactions),
  attachments: many(attachments),
}));

export type User = typeof users.$inferSelect;
export type DirectConversation = typeof directConversations.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
