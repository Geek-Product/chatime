import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index';
import { channels, messageMentions, messages, users } from '../db/schema';
import { getWorkspaceIdsForUser } from '../lib/access';
import { authenticate, requireUser } from '../lib/auth';
import { firstUnreadMessage, unreadByChannel, unreadByConversation, unreadTotal } from '../lib/unread';

export default async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/unread', async (req) => {
    const me = requireUser(req);
    const workspaceIds = await getWorkspaceIdsForUser(me.id);
    const [channels_, conversations] = await Promise.all([
      unreadByChannel(me.id, workspaceIds),
      unreadByConversation(me.id, workspaceIds),
    ]);
    const jump = await Promise.all([
      ...channels_.filter((c) => c.unread > 0).map(async (c) => {
        const id = await firstUnreadMessage(c.channelId, null, me.id);
        return id ? { channelId: c.channelId, conversationId: null, messageId: id } : null;
      }),
      ...conversations.filter((c) => c.unread > 0).map(async (c) => {
        const id = await firstUnreadMessage(null, c.conversationId, me.id);
        return id ? { channelId: null, conversationId: c.conversationId, messageId: id } : null;
      }),
    ]);
    return {
      channels: channels_,
      conversations,
      jump: jump.filter(Boolean),
      ...(await unreadTotal(me.id, workspaceIds)),
    };
  });

  app.get('/notifications/mentions', async (req) => {
    const me = requireUser(req);
    const rows = await db
      .select({
        messageId: messages.id,
        channelName: channels.name,
        channelId: channels.id,
        workspaceId: channels.workspaceId,
        authorName: users.displayName,
        content: messages.content,
        createdAt: messages.createdAt,
        readAt: messageMentions.readAt,
      })
      .from(messageMentions)
      .innerJoin(messages, eq(messages.id, messageMentions.messageId))
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .innerJoin(users, eq(users.id, messages.userId))
      .where(and(eq(messageMentions.userId, me.id), isNull(messages.deletedAt), isNull(messages.directConversationId)))
      .orderBy(desc(messages.createdAt))
      .limit(30);
    return { mentions: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  });

  app.post('/notifications/read', async (req) => {
    const me = requireUser(req);
    const body = z.object({ messageIds: z.array(z.string().uuid()).max(100).optional() }).parse(req.body ?? {});
    const where = body.messageIds
      ? and(eq(messageMentions.userId, me.id), inArray(messageMentions.messageId, body.messageIds))
      : and(eq(messageMentions.userId, me.id), isNull(messageMentions.readAt));
    await db.update(messageMentions).set({ readAt: new Date() }).where(where);
    return { ok: true };
  });

  app.delete('/notifications/mentions/:messageId', async (req) => {
    const me = requireUser(req);
    const { messageId } = z.object({ messageId: z.string().uuid() }).parse(req.params);
    await db
      .delete(messageMentions)
      .where(and(eq(messageMentions.userId, me.id), eq(messageMentions.messageId, messageId)));
    return { ok: true };
  });
}

