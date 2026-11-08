import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { directConversations, users } from '../db/schema';
import { authorColumns } from './messages';

export type SerializedConversation = Awaited<ReturnType<typeof listConversations>>[number];

// The participant who is not the viewer.
const otherId = (userId: string) =>
  sql`case when ${directConversations.userA} = ${userId} then ${directConversations.userB} else ${directConversations.userA} end`;
const isParticipant = (userId: string) =>
  or(eq(directConversations.userA, userId), eq(directConversations.userB, userId));
const lastAt = sql`coalesce((
  select max(m.created_at) from messages m where m.direct_conversation_id = ${directConversations.id}
), ${directConversations.createdAt})`;

const baseQuery = (userId: string) =>
  db
    .select({
      id: directConversations.id,
      workspaceId: directConversations.workspaceId,
      createdAt: directConversations.createdAt,
      other: authorColumns,
      lastMessageAt: sql<string | null>`(
        select max(m.created_at) from messages m
        where m.direct_conversation_id = ${directConversations.id} and m.deleted_at is null
      )`,
      lastPreview: sql<string | null>`(
        select case when m.content = '' then '📎 Attachment' else m.content end from messages m
        where m.direct_conversation_id = ${directConversations.id} and m.deleted_at is null
        order by m.created_at desc limit 1
      )`,
      lastAuthorIsMe: sql<boolean | null>`(
        select m.user_id = ${userId} from messages m
        where m.direct_conversation_id = ${directConversations.id} and m.deleted_at is null
        order by m.created_at desc limit 1
      )`,
      sortKey: lastAt,
    })
    .from(directConversations)
    .innerJoin(users, eq(users.id, otherId(userId)));

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

function toDto(r: Row) {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    other: r.other,
    lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).toISOString() : null,
    // Strip formatting markers so the sidebar preview reads like plain text.
    lastPreview: r.lastPreview ? r.lastPreview.replace(/[*_~`]/g, '').slice(0, 120) : null,
    lastAuthorIsMe: Boolean(r.lastAuthorIsMe),
    createdAt: r.createdAt.toISOString(),
  };
}

export async function listConversations(workspaceId: string, userId: string) {
  const rows = await baseQuery(userId)
    .where(and(eq(directConversations.workspaceId, workspaceId), isParticipant(userId)))
    .orderBy(sql`${lastAt} desc`);
  return rows.map(toDto);
}

/** Workspace of a conversation the user takes part in, or null if they are not a participant. */
export async function conversationWorkspaceForUser(conversationId: string, userId: string) {
  const [row] = await db
    .select({ workspaceId: directConversations.workspaceId })
    .from(directConversations)
    .where(and(eq(directConversations.id, conversationId), isParticipant(userId)));
  return row?.workspaceId ?? null;
}

export async function getConversationDto(conversationId: string, userId: string) {
  const [row] = await baseQuery(userId).where(and(eq(directConversations.id, conversationId), isParticipant(userId)));
  return row ? toDto(row) : null;
}
