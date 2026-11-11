import type { FastifyInstance } from 'fastify';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index';
import { attachments, messages, reactions, users, workspaceMembers } from '../db/schema';
import { authenticate, requireUser } from '../lib/auth';
import { historyAround, historyBefore, type ChatLocation } from '../lib/chat';
import { MAX_FILES_PER_MESSAGE } from '../lib/attachments';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { postMessage, serializeMessages } from '../lib/messages';
import { broadcastToTarget, resolveTarget } from '../lib/targets';

const messageParams = z.object({ messageId: z.string().uuid() });

export default async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.post('/messages', async (req, reply) => {
    const me = requireUser(req);
    const body = z.object({
      channelId: z.string().uuid().optional(),
      conversationId: z.string().uuid().optional(),
      // A message may consist of files only, but needs some text or at least one attachment.
      content: z.string().trim().max(8000).default(''),
      parentId: z.string().uuid().nullish(),
      attachmentIds: z.array(z.string().uuid()).max(MAX_FILES_PER_MESSAGE).default([]),
    }).parse(req.body);
    if (Boolean(body.channelId) === Boolean(body.conversationId)) {
      throw badRequest('Provide either channelId or conversationId');
    }
    if (!body.content && body.attachmentIds.length === 0) throw badRequest('Write something or attach a file');

    // Threads live in channels only.
    if (body.conversationId && body.parentId) throw badRequest('Direct messages do not support threads');
    const target = body.conversationId
      ? await resolveTarget({ channelId: null, directConversationId: body.conversationId }, me.id)
      : await resolveTarget({ channelId: body.channelId!, directConversationId: null }, me.id);

    if (body.parentId) {
      const [p] = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, body.parentId));
      if (!p || p.channelId !== body.channelId) throw badRequest('Parent message not found in this channel');
    }

    // Attachments are uploaded first and must be the uploader's own, not yet used by another message.
    if (body.attachmentIds.length) {
      const owned = await db
        .select({ id: attachments.id, messageId: attachments.messageId })
        .from(attachments)
        .where(and(inArray(attachments.id, body.attachmentIds), eq(attachments.uploaderId, me.id)));
      if (owned.length !== new Set(body.attachmentIds).size || owned.some((a) => a.messageId)) {
        throw badRequest('One of the attachments is invalid or already used');
      }
    }

    const { inserted, mentionIds } = await postMessage({
      target,
      author: me,
      content: body.content,
      parentId: body.parentId,
    });

    if (body.attachmentIds.length) {
      await db.update(attachments).set({ messageId: inserted.id }).where(inArray(attachments.id, body.attachmentIds));
    }

    const [message] = await serializeMessages([inserted.id], me.id);
    return reply.code(201).send({ message: { ...message, mentionUserIds: mentionIds } });
  });

  app.get('/channels/:channelId/history', async (req) => {
    const me = requireUser(req);
    const { channelId } = z.object({ channelId: z.string().uuid() }).parse(req.params);
    const query = z.object({
      around: z.string().uuid().optional(),
      before: z.string().datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }).parse(req.query);
    const loc: ChatLocation = { channelId, conversationId: null };
    if (query.around) return historyAround(loc, query.around, me.id, query.limit);
    if (query.before) return historyBefore(loc, query.before, me.id, query.limit);
    return historyBefore(loc, new Date(Date.now() + 60_000).toISOString(), me.id, query.limit);
  });

  app.get('/dms/:conversationId/history', async (req) => {
    const me = requireUser(req);
    const { conversationId } = z.object({ conversationId: z.string().uuid() }).parse(req.params);
    const query = z.object({
      around: z.string().uuid().optional(),
      before: z.string().datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(40),
    }).parse(req.query);
    const loc: ChatLocation = { channelId: null, conversationId };
    if (query.around) return historyAround(loc, query.around, me.id, query.limit);
    if (query.before) return historyBefore(loc, query.before, me.id, query.limit);
    return historyBefore(loc, new Date(Date.now() + 60_000).toISOString(), me.id, query.limit);
  });

  app.get('/messages/:messageId', async (req) => {
    const me = requireUser(req);
    const { messageId } = messageParams.parse(req.params);
    const [msg] = await db
      .select({ channelId: messages.channelId, directConversationId: messages.directConversationId })
      .from(messages)
      .where(eq(messages.id, messageId));
    if (!msg) throw notFound('Message not found');
    await resolveTarget(msg, me.id);
    const [message] = await serializeMessages([messageId], me.id);
    return { message };
  });

  app.get('/messages/:messageId/replies', async (req) => {
    const me = requireUser(req);
    const { messageId } = messageParams.parse(req.params);
    const [parent] = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, messageId));
    if (!parent?.channelId) throw notFound('Message not found');
    await resolveTarget({ channelId: parent.channelId, directConversationId: null }, me.id);
    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.parentId, messageId))
      .orderBy(asc(messages.createdAt));
    const replies = await serializeMessages(rows.map((r) => r.id), me.id);
    return { replies };
  });

  app.patch('/messages/:messageId', async (req) => {
    const me = requireUser(req);
    const { messageId } = messageParams.parse(req.params);
    const body = z.object({ content: z.string().trim().min(1).max(8000) }).parse(req.body);
    const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
    if (!msg) throw notFound('Message not found');
    if (msg.userId !== me.id) throw forbidden('You can only edit your own messages');
    const target = await resolveTarget(msg, me.id);

    await db.update(messages).set({ content: body.content, editedAt: new Date() }).where(eq(messages.id, messageId));
    const [message] = await serializeMessages([messageId], me.id);
    broadcastToTarget(target, { type: 'message.updated', message });
    return { message };
  });

  app.delete('/messages/:messageId', async (req) => {
    const me = requireUser(req);
    const { messageId } = messageParams.parse(req.params);
    const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
    if (!msg) throw notFound('Message not found');
    const target = await resolveTarget(msg, me.id);
    const isAuthor = msg.userId === me.id;
    let canModerate = false;
    if (!isAuthor && target.kind === 'channel') {
      const [membership] = await db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, target.channel.workspaceId), eq(workspaceMembers.userId, me.id)));
      canModerate = membership?.role === 'owner' || membership?.role === 'admin';
    }
    if (!isAuthor && !canModerate) throw forbidden('You can only delete your own messages');

    await db.update(messages).set({ deletedAt: new Date(), content: '' }).where(eq(messages.id, messageId));
    broadcastToTarget(target, {
      type: 'message.deleted',
      id: messageId,
      channelId: msg.channelId,
      conversationId: msg.directConversationId,
      parentId: msg.parentId,
    });
    return { ok: true };
  });

  app.post('/messages/:messageId/reactions', async (req) => {
    const me = requireUser(req);
    const { messageId } = messageParams.parse(req.params);
    const body = z.object({ emoji: z.string().min(1).max(16) }).parse(req.body);
    const [msg] = await db
      .select({ channelId: messages.channelId, directConversationId: messages.directConversationId })
      .from(messages)
      .where(eq(messages.id, messageId));
    if (!msg) throw notFound('Message not found');
    const target = await resolveTarget(msg, me.id);

    const [existing] = await db
      .select()
      .from(reactions)
      .where(and(eq(reactions.messageId, messageId), eq(reactions.userId, me.id), eq(reactions.emoji, body.emoji)));
    if (existing) {
      await db.delete(reactions).where(and(eq(reactions.messageId, messageId), eq(reactions.userId, me.id), eq(reactions.emoji, body.emoji)));
    } else {
      await db.insert(reactions).values({ messageId, userId: me.id, emoji: body.emoji });
    }

    const [updated] = await serializeMessages([messageId], me.id);
    broadcastToTarget(target, { type: 'reaction.updated', messageId, reactions: updated.reactions });
    return { reactions: updated.reactions };
  });
}
