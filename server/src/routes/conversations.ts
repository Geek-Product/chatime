import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { directConversationReads, messages } from '../db/schema';
import { assertWorkspaceMember, ensureConversation, getConversationForUser } from '../lib/access';
import { authenticate, requireUser } from '../lib/auth';
import { getConversationDto, listConversations } from '../lib/conversations';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { hub } from '../lib/hub';
import { latestDirectMessages, serializeMessages } from '../lib/messages';
import { resolveTarget, targetWorkspaceId } from '../lib/targets';

const params = (key: string) => z.object({ [key]: z.string().uuid() });

export default async function conversationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/workspaces/:workspaceId/conversations', async (req) => {
    const me = requireUser(req);
    const { workspaceId } = params('workspaceId').parse(req.params);
    await assertWorkspaceMember(workspaceId, me.id);
    return { conversations: await listConversations(workspaceId, me.id) };
  });

  /** Open (or reuse) the 1:1 conversation with a workspace member. */
  app.post('/workspaces/:workspaceId/conversations', async (req, reply) => {
    const me = requireUser(req);
    const { workspaceId } = params('workspaceId').parse(req.params);
    const body = z.object({ userId: z.string().uuid() }).parse(req.body);
    await assertWorkspaceMember(workspaceId, me.id);
    if (body.userId === me.id) throw badRequest('You cannot start a conversation with yourself');
    await assertWorkspaceMember(workspaceId, body.userId);

    const { conversation, created } = await ensureConversation(workspaceId, me.id, body.userId);
    for (const userId of [conversation.userA, conversation.userB]) {
      const dto = await getConversationDto(conversation.id, userId);
      if (dto) hub.sendToUser(userId, { type: 'conversation.created', conversation: dto });
    }
    return reply.code(created ? 201 : 200).send({ conversation: await getConversationDto(conversation.id, me.id) });
  });

  app.get('/dms/:conversationId/messages', async (req) => {
    const me = requireUser(req);
    const { conversationId } = params('conversationId').parse(req.params);
    await getConversationForUser(conversationId, me.id);
    const query = z.object({
      before: z.string().datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(req.query);

    const ids = await latestDirectMessages(conversationId, query.limit, query.before);
    const messages = await serializeMessages(ids, me.id);
    const hasMore = ids.length === query.limit
      && (await latestDirectMessages(conversationId, 1, messages[0]?.createdAt)).length > 0;
    return { messages, hasMore };
  });

  app.post('/dms/:conversationId/read', async (req) => {
    const me = requireUser(req);
    const { conversationId } = params('conversationId').parse(req.params);
    await getConversationForUser(conversationId, me.id);
    const now = new Date();
    await db
      .insert(directConversationReads)
      .values({ conversationId, userId: me.id, lastReadAt: now })
      .onConflictDoUpdate({
        target: [directConversationReads.conversationId, directConversationReads.userId],
        set: { lastReadAt: now },
      });
    return { ok: true };
  });

  /** Resolves a message id the user can see to the channel/DM it lives in (notification deep links). */
  app.get('/messages/:messageId/location', async (req) => {
    const me = requireUser(req);
    const { messageId } = params('messageId').parse(req.params);
    const [msg] = await db
      .select({ channelId: messages.channelId, directConversationId: messages.directConversationId })
      .from(messages)
      .where(eq(messages.id, messageId));
    if (!msg) throw notFound('Message not found');
    try {
      const target = await resolveTarget(msg, me.id);
      return {
        workspaceId: targetWorkspaceId(target),
        channelId: msg.channelId,
        conversationId: msg.directConversationId,
        channelName: target.kind === 'channel' ? target.channel.name : null,
      };
    } catch {
      throw forbidden('You do not have access to this message');
    }
  });
}
