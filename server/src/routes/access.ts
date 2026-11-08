import type { FastifyInstance } from 'fastify';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index';
import { channelMembers, channels, joinRequests, users, workspaceMembers } from '../db/schema';
import { accessStatusOf, adminWorkspaceIds } from '../lib/access-status';
import { authenticate, requireUser } from '../lib/auth';
import { getWorkspaceIdsForUser } from '../lib/access';
import { forbidden, notFound } from '../lib/errors';
import { hub } from '../lib/hub';

const workspaceParams = z.object({ workspaceId: z.string().uuid() });
const requestParams = workspaceParams.extend({ userId: z.string().uuid() });

async function requireAdmin(adminId: string, workspaceId: string) {
  const ids = await adminWorkspaceIds(adminId);
  if (!ids.includes(workspaceId)) throw forbidden('Only workspace owners and admins can review sign-ups');
  return workspaceId;
}

/**
 * Sign-ups wait in one shared queue; approving one joins the applicant to the reviewing
 * admin's workspace. Anyone who already belongs to a workspace is not waiting any more.
 */
async function pendingUsers() {
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      avatarColor: users.avatarColor,
      createdAt: joinRequests.createdAt,
      message: joinRequests.message,
    })
    .from(joinRequests)
    .innerJoin(users, eq(users.id, joinRequests.userId))
    .where(
      and(
        eq(joinRequests.status, 'pending'),
        sql`not exists (select 1 from workspace_members m where m.user_id = ${users.id})`,
      ),
    )
    .orderBy(joinRequests.createdAt);
}

export default async function accessRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/access/workspaces', async (req) => {
    const me = requireUser(req);
    const rows = await db
      .select({ id: workspaceMembers.workspaceId, name: sql<string>`(select name from workspaces w where w.id = ${workspaceMembers.workspaceId})` })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, me.id), inArray(workspaceMembers.role, ['owner', 'admin'])));
    if (rows.length === 0) return { workspaces: [], pending: 0 };
    return { workspaces: rows, pending: (await pendingUsers()).length };
  });

  /** The signed-in account's own access state, read by the waiting screen. */
  app.get('/access/me', async (req) => {
    const me = requireUser(req);
    return { status: await accessStatusOf(me.id), workspaceIds: await getWorkspaceIdsForUser(me.id) };
  });

  app.get('/workspaces/:workspaceId/access-requests', async (req) => {
    const me = requireUser(req);
    const { workspaceId } = workspaceParams.parse(req.params);
    await requireAdmin(me.id, workspaceId);
    return { users: await pendingUsers() };
  });

  app.post('/workspaces/:workspaceId/access-requests/:userId/approve', async (req) => {
    const me = requireUser(req);
    const { workspaceId, userId } = requestParams.parse(req.params);
    await requireAdmin(me.id, workspaceId);
    const [request] = await db.select().from(joinRequests).where(eq(joinRequests.userId, userId));
    if (!request) throw notFound('No sign-up request from this person');
    if (request.status === 'declined') throw forbidden('This sign-up was declined; the person must apply again');

    await db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: 'member' })
      .onConflictDoNothing();
    const [general] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, 'general')));
    if (general) await db.insert(channelMembers).values({ channelId: general.id, userId }).onConflictDoNothing();
    await db
      .update(joinRequests)
      .set({ status: 'accepted', decidedBy: me.id, decidedAt: new Date() })
      .where(eq(joinRequests.userId, userId));
    hub.sendToUser(userId, { type: 'access.changed', status: 'approved', workspaceId });
    return { ok: true };
  });

  app.post('/workspaces/:workspaceId/access-requests/:userId/decline', async (req) => {
    const me = requireUser(req);
    const { workspaceId, userId } = requestParams.parse(req.params);
    await requireAdmin(me.id, workspaceId);
    const updated = await db
      .update(joinRequests)
      .set({ status: 'declined', decidedBy: me.id, decidedAt: new Date() })
      .where(eq(joinRequests.userId, userId))
      .returning({ userId: joinRequests.userId });
    if (!updated.length) throw notFound('No sign-up request from this person');
    hub.sendToUser(userId, { type: 'access.changed', status: 'declined', workspaceId });
    return { ok: true };
  });
}
