import { and, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { channelMembers, channels, directConversations, workspaceMembers, workspaces } from '../db/schema';
import { forbidden, notFound } from './errors';

export async function getWorkspaceIdsForUser(userId: string) {
  const rows = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return rows.map((r) => r.id);
}

export async function assertWorkspaceMember(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  if (!row) throw forbidden('Not a member of this workspace');
  return row;
}

export async function assertWorkspaceAdmin(workspaceId: string, userId: string, message = 'Only workspace owners and admins can do that') {
  const row = await assertWorkspaceMember(workspaceId, userId);
  if (row.role === 'member') throw forbidden(message);
  return row;
}

export async function getChannelForUser(channelId: string, userId: string) {
  const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) throw notFound('Channel not found');
  await assertWorkspaceMember(channel.workspaceId, userId);
  if (!channel.isPrivate) return channel;

  const [member] = await db
    .select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
  if (!member) throw forbidden('You are not a member of this private channel');
  return channel;
}

export async function getConversationForUser(conversationId: string, userId: string) {
  const [conv] = await db.select().from(directConversations).where(eq(directConversations.id, conversationId));
  if (!conv) throw notFound('Conversation not found');
  if (conv.userA !== userId && conv.userB !== userId) throw forbidden('This conversation is private');
  const otherId = conv.userA === userId ? conv.userB : conv.userA;
  return { ...conv, otherId };
}

/** The single conversation between two users (either ordering), created if missing. */
export async function ensureConversation(workspaceId: string, userId: string, otherId: string) {
  const [a, b] = [userId, otherId].sort();
  const [existing] = await db
    .select()
    .from(directConversations)
    .where(and(
      eq(directConversations.workspaceId, workspaceId),
      eq(directConversations.userA, a),
      eq(directConversations.userB, b),
    ));
  if (existing) return { conversation: existing, created: false };
  const [created] = await db
    .insert(directConversations)
    .values({ workspaceId, userA: a, userB: b })
    .onConflictDoNothing()
    .returning();
  if (created) return { conversation: created, created: true };
  const [raced] = await db
    .select()
    .from(directConversations)
    .where(and(
      eq(directConversations.workspaceId, workspaceId),
      eq(directConversations.userA, a),
      eq(directConversations.userB, b),
    ));
  return { conversation: raced, created: false };
}

export async function getWorkspace(workspaceId: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws) throw notFound('Workspace not found');
  return ws;
}
