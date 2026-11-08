import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index';
import { channelMembers, channels, users, workspaceMembers, workspaces } from '../db/schema';
import { assertWorkspaceAdmin, assertWorkspaceMember } from '../lib/access';
import { adminWorkspaceIds } from '../lib/access-status';
import { authenticate, requireUser } from '../lib/auth';
import { conflict, forbidden, notFound } from '../lib/errors';
import { hub } from '../lib/hub';

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'workspace';

export default async function workspaceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/workspaces', async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: workspaceMembers.role,
        ownerId: workspaces.ownerId,
        createdAt: workspaces.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(workspaces.createdAt);
    return { workspaces: rows };
  });

  app.post('/workspaces', async (req, reply) => {
    const user = requireUser(req);
    // Workspace creation is an administrative action: owner/admin of at least one workspace.
    if ((await adminWorkspaceIds(user.id)).length === 0) {
      throw forbidden('Only workspace owners and admins can create workspaces');
    }
    const body = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
    const [ws] = await db
      .insert(workspaces)
      .values({ name: body.name, slug: `${slugify(body.name)}-${Math.random().toString(36).slice(2, 7)}`, ownerId: user.id })
      .returning();
    await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
    const [channel] = await db
      .insert(channels)
      .values({ workspaceId: ws.id, name: 'general', topic: 'Team-wide announcements', createdBy: user.id })
      .returning();
    await db.insert(channelMembers).values({ channelId: channel.id, userId: user.id });
    return reply.code(201).send({ workspace: { ...ws, role: 'owner' }, channel });
  });

  app.patch('/workspaces/:workspaceId', async (req) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    await assertWorkspaceAdmin(workspaceId, user.id, 'Only workspace owners and admins can update the workspace');
    const body = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
    const [updated] = await db
      .update(workspaces)
      .set({ name: body.name })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return { workspace: updated };
  });

  app.get('/workspaces/:workspaceId/members', async (req) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    await assertWorkspaceMember(workspaceId, user.id);
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarColor: users.avatarColor,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(users.displayName);
    return { members: rows };
  });

  app.get('/workspaces/:workspaceId/members/:userId', async (req) => {
    const user = requireUser(req);
    const { workspaceId, userId } = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
    await assertWorkspaceMember(workspaceId, user.id);
    const [row] = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        avatarColor: users.avatarColor,
        createdAt: users.createdAt,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.joinedAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    if (!row) throw notFound('This person is not a member of this workspace');
    return { member: row };
  });

  app.get('/workspaces/:workspaceId/channels', async (req) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    await assertWorkspaceMember(workspaceId, user.id);

    // Public channels + private ones the user belongs to
    const rows = await db
      .select({
        id: channels.id,
        workspaceId: channels.workspaceId,
        name: channels.name,
        topic: channels.topic,
        isPrivate: channels.isPrivate,
        createdAt: channels.createdAt,
        lastReadAt: channelMembers.lastReadAt,
        isMember: sql<boolean>`${channelMembers.userId} is not null`,
        memberCount: sql<number>`(select count(*)::int from channel_members cm where cm.channel_id = ${channels.id})`,
      })
      .from(channels)
      .leftJoin(channelMembers, and(eq(channelMembers.channelId, channels.id), eq(channelMembers.userId, user.id)))
      .where(and(
        eq(channels.workspaceId, workspaceId),
        sql`(${channels.isPrivate} = false or ${channelMembers.userId} is not null)`,
      ))
      .orderBy(channels.isPrivate, channels.name);
    return { channels: rows };
  });

  app.post('/workspaces/:workspaceId/channels', async (req, reply) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    await assertWorkspaceMember(workspaceId, user.id);
    const body = z.object({
      name: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-_]{1,79}$/, 'lowercase letters, numbers, - and _'),
      topic: z.string().trim().max(250).optional(),
      isPrivate: z.boolean().default(false),
      memberIds: z.array(z.string().uuid()).max(100).default([]),
    }).parse(req.body);

    const [existing] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.workspaceId, workspaceId), sql`lower(${channels.name}) = ${body.name}`));
    if (existing) throw conflict('A channel with that name already exists', 'ALREADY_EXISTS');

    const [channel] = await db
      .insert(channels)
      .values({ workspaceId, name: body.name, topic: body.topic ?? null, isPrivate: body.isPrivate, createdBy: user.id })
      .returning();
    const invitees = [...new Set(body.memberIds)].filter((id) => id !== user.id);
    const validInvitees = invitees.length
      ? (await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, invitees))))
        .map((r) => r.userId)
      : [];
    await db
      .insert(channelMembers)
      .values([user.id, ...validInvitees].map((userId) => ({ channelId: channel.id, userId })));

    const payload = { ...channel, isMember: true, memberCount: 1 + validInvitees.length, lastReadAt: channel.createdAt };
    for (const userId of validInvitees) {
      hub.sendToUser(userId, { type: 'channel.created', channel: payload });
    }
    if (channel.isPrivate) {
      // Only tell the creator; they can invite people from the channel view.
      hub.sendToUser(user.id, { type: 'channel.created', channel: payload });
    } else {
      hub.broadcastToWorkspace(workspaceId, { type: 'channel.created', channel: payload });
    }
    return reply.code(201).send({ channel: payload });
  });
}
