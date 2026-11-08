import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from '../db/index';
import { messages } from '../db/schema';
import { getChannelForUser, getConversationForUser } from './access';
import { serializeMessages, type SerializedMessage } from './messages';

export type ChatLocation = { channelId: string | null; conversationId: string | null };

/** Keys match the client cache, which uses `channelId` or `directConversationId` to identify a list. */
export type ChatHistory = {
  channelId: string | null;
  directConversationId: string | null;
  messages: SerializedMessage[];
  hasMore: boolean;
};

const inChat = (loc: ChatLocation) =>
  loc.channelId ? eq(messages.channelId, loc.channelId) : eq(messages.directConversationId, loc.conversationId!);

const topLevel = (loc: ChatLocation, after?: Date, before?: Date) =>
  and(
    inChat(loc),
    isNull(messages.parentId),
    after ? gt(messages.createdAt, after) : undefined,
    before ? lt(messages.createdAt, before) : undefined,
  );

async function authorize(loc: ChatLocation, viewerId: string) {
  if (loc.channelId) await getChannelForUser(loc.channelId, viewerId);
  else await getConversationForUser(loc.conversationId!, viewerId);
}

async function createdAtOf(loc: ChatLocation, messageId: string) {
  const [row] = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(eq(messages.id, messageId), topLevel(loc)))
    .limit(1);
  return row?.createdAt ?? null;
}

async function newestIds(loc: ChatLocation, limit: number) {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(topLevel(loc))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);
  return { ids: rows.slice(0, limit).map((r) => r.id).reverse(), hasMore: rows.length > limit };
}

async function olderIds(loc: ChatLocation, before: Date, limit: number) {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(topLevel(loc, undefined, before))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);
  return { ids: rows.slice(0, limit).map((r) => r.id).reverse(), hasMore: rows.length > limit };
}

const result = async (loc: ChatLocation, ids: string[], hasMore: boolean, viewerId: string): Promise<ChatHistory> => ({
  channelId: loc.channelId,
  directConversationId: loc.conversationId,
  messages: await serializeMessages(ids, viewerId),
  hasMore,
});

/**
 * Context for a deep link: the page containing `messageId` with some older and newer messages, or
 * the newest page when the message is recent enough to be in it.
 */
export async function historyAround(loc: ChatLocation, messageId: string, viewerId: string, limit = 40) {
  await authorize(loc, viewerId);
  const newest = await newestIds(loc, limit);
  if (newest.ids.includes(messageId)) return result(loc, newest.ids, newest.hasMore, viewerId);

  const createdAt = await createdAtOf(loc, messageId);
  if (!createdAt) return result(loc, [], false, viewerId);

  const newerRows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(topLevel(loc, createdAt))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(limit);
  const newer = newerRows.slice(0, Math.max(0, limit - 1)).map((r) => r.id);
  const older = await olderIds(loc, createdAt, limit - 1 - newer.length);
  return result(loc, [...older.ids, messageId, ...newer], older.hasMore || newerRows.length > newer.length, viewerId);
}

/** Page ending at (and including) `messageId`, for "jump to first unread". */
export async function historyEndingAt(loc: ChatLocation, messageId: string, viewerId: string, limit = 40) {
  await authorize(loc, viewerId);
  const createdAt = await createdAtOf(loc, messageId);
  if (!createdAt) return historyAround(loc, messageId, viewerId, limit);
  const older = await olderIds(loc, createdAt, limit - 1);
  // Newest page wins when the jump point is already inside it (e.g. only one unread message).
  const newest = await newestIds(loc, limit);
  if (newest.ids.includes(messageId)) return result(loc, newest.ids, newest.hasMore, viewerId);
  return result(loc, [...older.ids, messageId], older.hasMore, viewerId);
}

export async function historyBefore(loc: ChatLocation, before: string, viewerId: string, limit = 40) {
  await authorize(loc, viewerId);
  const older = await olderIds(loc, new Date(before), limit);
  return result(loc, older.ids, older.hasMore, viewerId);
}
