import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../env';
import { db } from '../db/index';
import { joinRequests, refreshTokens, users, workspaceMembers } from '../db/schema';
import { hub } from '../lib/hub';
import { getWorkspaceIdsForUser } from '../lib/access';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  authenticate,
  hashPassword,
  hashToken,
  newRefreshToken,
  refreshCookieOptions,
  requireUser,
  signAccessToken,
  verifyPassword,
} from '../lib/auth';
import { HttpError, badRequest, conflict, unauthorized } from '../lib/errors';
import { accessStatusOf } from '../lib/access-status';

const credentials = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
});

const registerBody = credentials.extend({
  username: z.string().regex(/^[a-zA-Z0-9_.-]{2,32}$/, '2-32 chars: letters, numbers, _ . -'),
  displayName: z.string().trim().min(1).max(80),
  /** Optional note for the admin reviewing the sign-up. */
  message: z.string().trim().max(500).optional(),
});

const AVATAR_COLORS = ['#5865F2', '#EB459E', '#57F287', '#FEE75C', '#ED4245', '#3BA55D', '#FAA61A', '#9B59B6'];

function publicUser(u: typeof users.$inferSelect, status: 'approved' | 'pending' | 'declined' = 'approved') {
  return { id: u.id, email: u.email, username: u.username, displayName: u.displayName, avatarColor: u.avatarColor, status };
}

async function issueSession(reply: FastifyReply, userId: string) {
  const refresh = newRefreshToken();
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: hashToken(refresh),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
  });
  reply.setCookie(REFRESH_COOKIE, refresh, refreshCookieOptions());
  return { accessToken: await signAccessToken(userId), expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = registerBody.parse(req.body);
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(or(sql`lower(${users.email}) = lower(${body.email})`, sql`lower(${users.username}) = lower(${body.username})`));
    if (existing) throw conflict('Email or username already taken', 'ALREADY_EXISTS');

    const [user] = await db
      .insert(users)
      .values({
        email: body.email,
        username: body.username,
        displayName: body.displayName,
        passwordHash: await hashPassword(body.password),
        avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      })
      .returning();

    // New accounts wait in the admin's sign-up list until accepted.
    await db.insert(joinRequests).values({ userId: user.id, message: body.message || null });
    return reply.code(201).send({ user: publicUser(user, 'pending'), ...(await issueSession(reply, user.id)) });
  });

  app.post('/auth/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = credentials.parse(req.body);
    const [user] = await db
      .select()
      .from(users)
      .where(or(sql`lower(${users.email}) = lower(${body.email})`, sql`lower(${users.username}) = lower(${body.email})`));
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw unauthorized('Invalid email or password');
    }
    const status = await accessStatusOf(user.id);
    if (status === 'declined') throw new HttpError(403, 'SIGNUP_DECLINED', 'Your sign-up request was declined by an admin');
    return { user: publicUser(user, status), ...(await issueSession(reply, user.id)) };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('No session');
    const [row] = await db
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(and(
        eq(refreshTokens.tokenHash, hashToken(token)),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, new Date()),
      ));
    if (!row) {
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
      throw unauthorized('Session expired');
    }
    const [user] = await db.select().from(users).where(eq(users.id, row.userId));
    if (!user) throw unauthorized('User no longer exists');

    // rotate: revoke the presented token before issuing a new one
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
    return { user: publicUser(user, await accessStatusOf(user.id)), ...(await issueSession(reply, user.id)) };
  });

  app.post('/auth/password', { preHandler: authenticate, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const me = requireUser(req);
    const body = z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(8).max(200),
    }).parse(req.body);
    const [user] = await db.select().from(users).where(eq(users.id, me.id));
    if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw unauthorized('Current password is incorrect', 'WRONG_PASSWORD');
    }
    if (body.currentPassword === body.newPassword) throw badRequest('Choose a different password');
    await db.update(users).set({ passwordHash: await hashPassword(body.newPassword) }).where(eq(users.id, me.id));
    // Sign out every other device; this browser gets a fresh session below.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, me.id), isNull(refreshTokens.revokedAt)));
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true, ...(await issueSession(reply, me.id)) };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, hashToken(token)));
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    return { ok: true };
  });

  app.patch('/auth/me', { preHandler: authenticate }, async (req) => {
    const me = requireUser(req);
    const body = z.object({
      displayName: z.string().trim().min(1).max(80).optional(),
      username: z.string().regex(/^[a-zA-Z0-9_.-]{2,32}$/, '2-32 chars: letters, numbers, _ . -').optional(),
      avatarColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a valid color').optional(),
    }).parse(req.body);

    if (body.username) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.username}) = lower(${body.username})`);
      if (taken && taken.id !== me.id) throw conflict('That username is taken', 'ALREADY_EXISTS');
    }
    const [updated] = await db
      .update(users)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.username !== undefined ? { username: body.username } : {}),
        ...(body.avatarColor !== undefined ? { avatarColor: body.avatarColor } : {}),
      })
      .where(eq(users.id, me.id))
      .returning();
    const user = {
      id: updated.id,
      email: updated.email,
      username: updated.username,
      displayName: updated.displayName,
      avatarColor: updated.avatarColor,
      status: await accessStatusOf(updated.id),
    };
    // Name/avatar changes are visible in everyone's message list and member sidebar.
    const workspaceIds = await getWorkspaceIdsForUser(me.id);
    const audience = workspaceIds.length
      ? await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(inArray(workspaceMembers.workspaceId, workspaceIds))
      : [];
    hub.broadcastToUsers([...new Set(audience.map((a) => a.userId))], {
      type: 'user.updated',
      user: { id: user.id, username: user.username, displayName: user.displayName, avatarColor: user.avatarColor },
    });
    return { user };
  });

  app.get('/auth/me', { preHandler: authenticate }, async (req) => {
    const me = requireUser(req);
    return { user: { ...me, status: await accessStatusOf(me.id) } };
  });
}
