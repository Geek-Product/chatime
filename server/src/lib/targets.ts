import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { channels, directConversations } from '../db/schema';
import { getChannelForUser } from './access';
import { forbidden, notFound } from './errors';
import { hub, type ServerEvent } from './hub';

export type MessageTarget =
  | { kind: 'channel'; channel: typeof channels.$inferSelect }
  | { kind: 'dm'; conversationId: string; workspaceId: string; recipients: string[] };

/** Where a message lives (channel or 1:1 conversation) and whether `userId` may see it. */
export async function resolveTarget(
  row: { channelId: string | null; directConversationId: string | null },
  userId: string,
): Promise<MessageTarget> {
  if (row.directConversationId) {
    const [conv] = await db.select().from(directConversations).where(eq(directConversations.id, row.directConversationId));
    if (!conv) throw notFound('Conversation not found');
    if (conv.userA !== userId && conv.userB !== userId) throw forbidden('This conversation is private');
    return {
      kind: 'dm',
      conversationId: conv.id,
      workspaceId: conv.workspaceId,
      recipients: [conv.userA, conv.userB],
    };
  }
  if (!row.channelId) throw notFound('Message has no target');
  return { kind: 'channel', channel: await getChannelForUser(row.channelId, userId) };
}

export function targetWorkspaceId(t: MessageTarget) {
  return t.kind === 'channel' ? t.channel.workspaceId : t.workspaceId;
}

/** Sends an event to everyone allowed to see the target: the whole workspace, or just the DM pair. */
export function broadcastToTarget(
  target: MessageTarget,
  event: ServerEvent | ((userId: string) => Promise<ServerEvent>),
) {
  if (target.kind === 'channel') {
    hub.broadcastToWorkspace(target.channel.workspaceId, event);
  } else if (typeof event === 'function') {
    hub.broadcastPerUser(target.recipients, event);
  } else {
    hub.broadcastToUsers(target.recipients, event);
  }
}
