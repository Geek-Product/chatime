import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '../db/index';
import {
  channelMembers,
  channels,
  directConversationReads,
  directConversations,
  messageMentions,
  messages,
} from '../db/schema';

/**
 * Unread counts per channel for a user. Private channels require channel membership;
 * public channels simply require workspace membership.
 */
export async function unreadByChannel(userId: string, workspaceIds: string[]) {
  if (workspaceIds.length === 0) return [];

  const rows = await db
    .select({
      channelId: channels.id,
      unread: sql<number>`count(${messages.id})::int`,
      unreadMentions: sql<number>`count(*) filter (where ${messageMentions.messageId} is not null)::int`,
      lastMessageAt: sql<string | null>`max(${messages.createdAt})`,
    })
    .from(channels)
    .leftJoin(
      channelMembers,
      and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, userId)),
    )
    .innerJoin(
      messages,
      and(
        eq(messages.channelId, channels.id),
        isNull(messages.parentId),
        isNull(messages.deletedAt),
        ne(messages.userId, userId),
        gt(messages.createdAt, sql`coalesce(${channelMembers.lastReadAt}, ${channels.createdAt})`),
      ),
    )
    .leftJoin(
      messageMentions,
      and(eq(messageMentions.messageId, messages.id), eq(messageMentions.userId, userId)),
    )
    .where(and(
      inArray(channels.workspaceId, workspaceIds),
      sql`(${channels.isPrivate} = false or ${channelMembers.userId} is not null)`,
    ))
    .groupBy(channels.id);

  return rows.map((r) => ({
    channelId: r.channelId,
    unread: r.unread,
    unreadMentions: r.unreadMentions,
  }));
}

export async function unreadByConversation(userId: string, workspaceIds: string[]) {
  if (workspaceIds.length === 0) return [];
  const rows = await db
    .select({
      conversationId: directConversations.id,
      unread: sql<number>`count(${messages.id})::int`,
    })
    .from(directConversations)
    .leftJoin(
      directConversationReads,
      and(eq(directConversationReads.conversationId, directConversations.id), eq(directConversationReads.userId, userId)),
    )
    .innerJoin(
      messages,
      and(
        eq(messages.directConversationId, directConversations.id),
        isNull(messages.parentId),
        isNull(messages.deletedAt),
        ne(messages.userId, userId),
        gt(messages.createdAt, sql`coalesce(${directConversationReads.lastReadAt}, ${directConversations.createdAt})`),
      ),
    )
    .where(and(
      inArray(directConversations.workspaceId, workspaceIds),
      or(eq(directConversations.userA, userId), eq(directConversations.userB, userId)),
    ))
    .groupBy(directConversations.id);
  return rows.map((r) => ({ conversationId: r.conversationId, unread: r.unread }));
}

export async function unreadTotal(userId: string, workspaceIds: string[]) {
  const [rows, dms] = await Promise.all([
    unreadByChannel(userId, workspaceIds),
    unreadByConversation(userId, workspaceIds),
  ]);
  return [...rows, ...dms].reduce(
    (acc, r) => ({ unread: acc.unread + r.unread, mentions: acc.mentions + ('unreadMentions' in r ? r.unreadMentions : 0) }),
    { unread: 0, mentions: 0 },
  );
}

/** Oldest unread top-level message in a channel or DM, used to place the "jump to unread" line. */
export async function firstUnreadMessage(channelId: string | null, conversationId: string | null, userId: string) {
  const readAt = channelId
    ? (await db
        .select({ lastReadAt: channelMembers.lastReadAt })
        .from(channelMembers)
        .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId))))[0]?.lastReadAt
    : (await db
        .select({ lastReadAt: directConversationReads.lastReadAt })
        .from(directConversationReads)
        .where(and(eq(directConversationReads.conversationId, conversationId!), eq(directConversationReads.userId, userId))))[0]?.lastReadAt;
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(
      channelId ? eq(messages.channelId, channelId) : eq(messages.directConversationId, conversationId!),
      isNull(messages.parentId),
      isNull(messages.deletedAt),
      ne(messages.userId, userId),
      readAt ? gt(messages.createdAt, readAt) : undefined,
    ))
    .orderBy(messages.createdAt)
    .limit(1);
  return row?.id ?? null;
}
