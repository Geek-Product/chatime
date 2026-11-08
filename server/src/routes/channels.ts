import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index';
import { channelMembers, channels, users, workspaceMembers } from '../db/schema';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { assertWorkspaceMember, getChannelForUser } from '../lib/access';
import { authenticate, requireUser } from '../lib/auth';
import { hub } from '../lib/hub';
import { latestMessages, serializeMessages } from '../lib/messages';

const channelParams = z.object({ channelId: z.string().uuid() });

export default async function channelRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/channels/:channelId/messages', async (req) => {
    const user = requireUser(req);
    const { channelId } = channelParams.parse(req.params);
    const query = z.object({
      before: z.string().datetime({ offset: true }).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).parse(req.query);
    const channel = await getChannelForUser(channelId, user.id);

    const ids = await latestMessages(channel.id, query.limit, query.before);
    const messages = await serializeMessages(ids, user.id);
    const hasMore = ids.length === query.limit
      && (await latestMessages(channel.id, 1, messages[0]?.createdAt)).length > 0;
    return { messages, hasMore };
  });

  app.post('/channels/:channelId/join', async (req, reply) => {
    const user = requireUser(req);
    const { channelId } = channelParams.parse(req.params);
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) throw notFound('Channel not found');
    await assertWorkspaceMember(channel.workspaceId, user.id);

    await db
      .insert(channelMembers)
      .values({ channelId, userId: user.id })
      .onConflictDoNothing();
    return reply.code(201).send({ ok: true });
  });

  app.get('/channels/:channelId/members', async (req) => {
    const user = requireUser(req);
    const { channelId } = channelParams.parse(req.params);
    await getChannelForUser(channelId, user.id);
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarColor: users.avatarColor,
      })
      .from(channelMembers)
      .innerJoin(users, eq(users.id, channelMembers.userId))
      .where(eq(channelMembers.channelId, channelId))
      .orderBy(users.displayName);
    return { members: rows };
  });

  /** Adds workspace members to the channel (idempotent). Any channel member may invite. */
  app.post('/channels/:channelId/members', async (req, reply) => {
    const user = requireUser(req);
    const { channelId } = channelParams.parse(req.params);
    const body = z.object({ userIds: z.array(z.string().uuid()).min(1).max(100) }).parse(req.body);
    const channel = await getChannelForUser(channelId, user.id);

    const targets = [...new Set(body.userIds)];
    const inWorkspace = await db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, channel.workspaceId), inArray(workspaceMembers.userId, targets)));
    const allowed = new Set(inWorkspace.map((r) => r.userId));
    if (targets.some((id) => !allowed.has(id))) throw badRequest('Only workspace members can be added to a channel');

    const added = await db
      .insert(channelMembers)
      .values(targets.map((userId) => ({ channelId, userId })))
      .onConflictDoNothing()
      .returning({ userId: channelMembers.userId });

    for (const { userId } of added) {
      hub.sendToUser(userId, { type: 'channel.created', channel: { ...channel, isMember: true } });
    }
    return reply.code(added.length ? 201 : 200).send({ added: added.map((a) => a.userId) });
  });

  app.delete('/channels/:channelId/members/:userId', async (req) => {
    const user = requireUser(req);
    const { channelId, userId } = z.object({ channelId: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
    const channel = await getChannelForUser(channelId, user.id);
    await assertWorkspaceMember(channel.workspaceId, userId);
    if (channel.isPrivate) {
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(channelMembers)
        .where(eq(channelMembers.channelId, channelId));
      if (count.n <= 1) throw forbidden('A private channel needs at least one member');
    }
    await db.delete(channelMembers).where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)));
    return { ok: true };
  });

  app.patch('/channels/:channelId', async (req) => {
    const user = requireUser(req);
    const { channelId } = channelParams.parse(req.params);
    const channel = await getChannelForUser(channelId, user.id);
    const body = z.object({
      name: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-_]{1,79}$/, 'lowercase letters, numbers, - and _').optional(),
      topic: z.string().trim().max(250).nullable().optional(),
      isPrivate: z.boolean().optional(),
    }).parse(req.body);
    if (body.name && body.name !== channel.name) {
      const [existing] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(and(
          eq(channels.workspaceId, channel.workspaceId),
          eq(channels.name, body.name),
        ));
      if (existing) throw conflict('A channel with that name already exists', 'ALREADY_EXISTS');
    }
    const [updated] = await db
      .update(channels)
      .set({
        ...(body.name ? { name: body.name } : {}),
        ...(body.topic !== undefined ? { topic: body.topic || null } : {}),
        ...(body.isPrivate !== undefined ? { isPrivate: body.isPrivate } : {}),
      })
      .where(eq(channels.id, channelId))
      .returning();
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(channelMembers)
      .where(eq(channelMembers.channelId, channelId));
    const payload = { ...updated, isMember: true, memberCount: count.n };
    if (updated.isPrivate) {
      // Hidden from the rest of the workspace now: only current members keep a sidebar entry.
      for (const m of await db.select({ userId: channelMembers.userId }).from(channelMembers).where(eq(channelMembers.channelId, channelId))) {
        hub.sendToUser(m.userId, { type: 'channel.updated', channel: payload });
      }
    } else {
      // Visible to everyone: add the sidebar entry for people who were never members.
      const memberIds = new Set(
        (await db.select({ userId: channelMembers.userId }).from(channelMembers).where(eq(channelMembers.channelId, channelId))).map((m) => m.userId),
      );
      const everyone = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, channel.workspaceId));
      for (const { userId } of everyone) {
        const view = memberIds.has(userId) ? payload : { ...payload, isMember: false };
        const type = memberIds.has(userId) ? 'channel.updated' : 'channel.created';
        hub.sendToUser(userId, { type, channel: view });
      }
    }
    return { channel: payload };
  });

  app.post('/channels/:channelId/read', async (req) => {
    const user = requireUser(req);
    const { channelId } = channelParams.parse(req.params);
    await getChannelForUser(channelId, user.id);
    const now = new Date();
    await db
      .insert(channelMembers)
      .values({ channelId, userId: user.id, lastReadAt: now })
      .onConflictDoUpdate({
        target: [channelMembers.channelId, channelMembers.userId],
        set: { lastReadAt: now },
      });
    return { ok: true };
  });
}
