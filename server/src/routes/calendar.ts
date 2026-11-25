import type { FastifyInstance } from 'fastify';
import { and, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/index';
import { officeAbsences, users } from '../db/schema';
import { assertWorkspaceMember } from '../lib/access';
import { authenticate, requireUser } from '../lib/auth';
import { avatarUrl } from '../lib/avatar';
import { badRequest, forbidden, notFound } from '../lib/errors';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 90;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => isoDay(new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS));

function assertRange(startDate: string, endDate: string) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) throw badRequest('Enter valid dates');
  if (end < start) throw badRequest('The end date must be on or after the start date');
  if (end - start > MAX_SPAN_DAYS * DAY_MS) throw badRequest(`Keep a single absence under ${MAX_SPAN_DAYS} days`);
}

export default async function calendarRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  /** Absences overlapping [from, to], with the member they belong to. */
  app.get('/workspaces/:workspaceId/absences', async (req) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    const { from, to } = z.object({ from: day.optional(), to: day.optional() }).parse(req.query);
    await assertWorkspaceMember(workspaceId, user.id);

    const today = isoDay(new Date());
    const rangeFrom = from ?? today;
    const rangeTo = to ?? addDays(rangeFrom, 45);
    assertRange(rangeFrom, rangeTo);

    const rows = await db
      .select({
        id: officeAbsences.id,
        userId: officeAbsences.userId,
        displayName: users.displayName,
        username: users.username,
        title: users.title,
        avatarColor: users.avatarColor,
        avatarAttachmentId: users.avatarAttachmentId,
        startDate: officeAbsences.startDate,
        endDate: officeAbsences.endDate,
        note: officeAbsences.note,
      })
      .from(officeAbsences)
      .innerJoin(users, eq(users.id, officeAbsences.userId))
      .where(and(
        eq(officeAbsences.workspaceId, workspaceId),
        lte(officeAbsences.startDate, rangeTo),
        gte(officeAbsences.endDate, rangeFrom),
      ))
      .orderBy(officeAbsences.startDate, users.displayName);

    return {
      absences: rows.map(({ avatarAttachmentId, ...row }) => ({
        ...row,
        avatarUrl: avatarUrl(avatarAttachmentId),
        mine: row.userId === user.id,
      })),
    };
  });

  /** Mark yourself away from the office. */
  app.post('/workspaces/:workspaceId/absences', async (req, reply) => {
    const user = requireUser(req);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(req.params);
    await assertWorkspaceMember(workspaceId, user.id);
    const body = z.object({
      startDate: day,
      endDate: day,
      note: z.string().trim().max(160).optional(),
    }).parse(req.body);
    assertRange(body.startDate, body.endDate);

    const [created] = await db
      .insert(officeAbsences)
      .values({
        workspaceId,
        userId: user.id,
        startDate: body.startDate,
        endDate: body.endDate,
        note: body.note || null,
      })
      .returning();
    return reply.code(201).send({ absence: created });
  });

  /** Remove an absence: your own, or anyone's if you own/admin the workspace. */
  app.delete('/workspaces/:workspaceId/absences/:absenceId', async (req) => {
    const user = requireUser(req);
    const { workspaceId, absenceId } = z
      .object({ workspaceId: z.string().uuid(), absenceId: z.string().uuid() })
      .parse(req.params);
    const me = await assertWorkspaceMember(workspaceId, user.id);
    const [row] = await db
      .select({ id: officeAbsences.id, userId: officeAbsences.userId })
      .from(officeAbsences)
      .where(and(eq(officeAbsences.id, absenceId), eq(officeAbsences.workspaceId, workspaceId)));
    if (!row) throw notFound('That absence no longer exists');
    if (row.userId !== user.id && me.role === 'member') {
      throw forbidden('Only workspace owners and admins can remove someone else’s absence');
    }
    await db.delete(officeAbsences).where(eq(officeAbsences.id, row.id));
    return { ok: true };
  });
}
