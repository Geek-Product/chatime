import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/index';
import { messageMentions, messages, reactions, users } from '../db/schema';
import { attachmentsForMessages, toAttachmentDto } from './attachments';

export const authorColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarColor: users.avatarColor,
};

const parent = alias(messages, 'parent');
const parentAuthor = alias(users, 'parent_author');

export type SerializedMessage = Awaited<ReturnType<typeof serializeMessages>>[number];

export async function serializeMessages(ids: string[], viewerId: string) {
  if (ids.length === 0) return [];

  const rows = await db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      directConversationId: messages.directConversationId,
      parentId: messages.parentId,
      content: messages.content,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      createdAt: messages.createdAt,
      author: authorColumns,
      parentContent: parent.content,
      parentAuthorName: parentAuthor.displayName,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.userId))
    .leftJoin(parent, eq(parent.id, messages.parentId))
    .leftJoin(parentAuthor, eq(parentAuthor.id, parent.userId))
    .where(inArray(messages.id, ids));

  const reactionRows = await db
    .select({
      messageId: reactions.messageId,
      emoji: reactions.emoji,
      userId: reactions.userId,
      username: users.username,
    })
    .from(reactions)
    .innerJoin(users, eq(users.id, reactions.userId))
    .where(inArray(reactions.messageId, ids));

  const mentionRows = await db
    .select({ messageId: messageMentions.messageId, userId: messageMentions.userId, username: users.username })
    .from(messageMentions)
    .innerJoin(users, eq(users.id, messageMentions.userId))
    .where(inArray(messageMentions.messageId, ids));

  const replyCounts = await db
    .select({ parentId: messages.parentId, count: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(inArray(messages.parentId, ids), isNull(messages.deletedAt)))
    .groupBy(messages.parentId);

  const attachmentRows = await attachmentsForMessages(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const r = byId.get(id);
    if (!r) return [];
    const rs = reactionRows.filter((x) => x.messageId === id);
    const grouped = new Map<string, { emoji: string; count: number; reactedByMe: boolean; users: string[] }>();
    for (const x of rs) {
      const g = grouped.get(x.emoji) ?? { emoji: x.emoji, count: 0, reactedByMe: false, users: [] };
      g.count++;
      g.users.push(x.username);
      if (x.userId === viewerId) g.reactedByMe = true;
      grouped.set(x.emoji, g);
    }
    const mentions = mentionRows.filter((x) => x.messageId === id).map((x) => x.username);
    return [{
      id: r.id,
      channelId: r.channelId,
      directConversationId: r.directConversationId,
      parentId: r.parentId,
      content: r.deletedAt ? '' : r.content,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      author: r.author,
      reactions: [...grouped.values()],
      attachments: r.deletedAt
        ? []
        : attachmentRows.filter((a) => a.messageId === id).map(toAttachmentDto),
      attachmentCount: attachmentRows.filter((a) => a.messageId === id).length,
      mentionUsernames: mentions,
      mentionsMe: mentionRows.some((x) => x.messageId === id && x.userId === viewerId),
      replyCount: replyCounts.find((c) => c.parentId === id)?.count ?? 0,
      parentPreview: r.parentId
        ? { id: r.parentId, authorName: r.parentAuthorName ?? 'someone', content: r.parentContent ?? '' }
        : null,
    }];
  });
}

/**
 * Usernames mentioned with @ in the content. Code spans/blocks are skipped so
 * `@decorator` inside code doesn't notify anyone.
 */
export function mentionedUsernames(content: string, memberUsernames: string[]): string[] {
  const prose = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
  const known = new Set(memberUsernames.map((u) => u.toLowerCase()));
  const found = new Set<string>();
  for (const m of prose.matchAll(/(^|[^\w@])@([a-zA-Z0-9_.-]{2,32})/g)) {
    const name = m[2].toLowerCase();
    if (known.has(name)) found.add(name);
  }
  return [...found];
}

/** Plain-text excerpt for notifications/toasts, with formatting markers removed. */
export function plainSnippet(content: string, max = 140) {
  const text = content
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export async function latestMessages(channelId: string, limit = 30, before?: string) {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(
      eq(messages.channelId, channelId),
      isNull(messages.parentId),
      before ? lt(messages.createdAt, sql`${before}::timestamptz`) : undefined,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.map((r) => r.id).reverse();
}

export async function latestDirectMessages(conversationId: string, limit = 30, before?: string) {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(
      eq(messages.directConversationId, conversationId),
      isNull(messages.parentId),
      before ? lt(messages.createdAt, sql`${before}::timestamptz`) : undefined,
    ))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.map((r) => r.id).reverse();
}
