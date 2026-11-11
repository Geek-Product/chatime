import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../env';
import { db } from '../db/index';
import { channels, users, webhooks } from '../db/schema';
import { assertWorkspaceAdmin } from '../lib/access';
import { authenticate, hashToken, newRefreshToken, requireUser } from '../lib/auth';
import { HttpError, notFound } from '../lib/errors';
import { hub } from '../lib/hub';
import { plainSnippet, postMessage, workspaceIdsOf } from '../lib/messages';
import { sendPushToUsers } from '../lib/push';
import { unreadTotal } from '../lib/unread';
import {
  announceRecipients,
  assertWebhookAdmin,
  createWebhookBot,
  isBlankContent,
  recordDelivery,
  renderWebhookContent,
  toWebhookDto,
} from '../lib/webhooks';

const webhookParams = z.object({ webhookId: z.string().uuid() });
const workspaceParams = z.object({ workspaceId: z.string().uuid() });
const WEBHOOK_BODY_LIMIT = 256 * 1024;

function tokenMatches(raw: string, storedHex: string) {
  const given = Buffer.from(hashToken(raw));
  const expected = Buffer.from(storedHex);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function notFoundWebhook(): never {
  // Unknown id, wrong token and disabled look the same so the URL can't be probed.
  throw notFound('Webhook not found');
}

/**
 * Public receiver: `POST /api/webhooks/:webhookId/:token`. Registered outside the authenticated
 * /api scope; `logLevel: 'warn'` keeps the secret path out of the access log.
 */
export async function webhookReceiverRoutes(app: FastifyInstance) {
  app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post('/api/webhooks/:webhookId/:token', {
    logLevel: 'warn',
    bodyLimit: WEBHOOK_BODY_LIMIT,
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = webhookParams.safeParse(req.params);
    if (!parsed.success) notFoundWebhook();
    const { webhookId } = parsed.data;
    const { token } = req.params as { token: string };

    const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));
    if (!hook || !tokenMatches(token, hook.tokenHash) || hook.disabledAt) notFoundWebhook();

    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const isJson = contentType === 'application/json' || contentType.endsWith('+json');
    if (!isJson && contentType !== 'text/plain') {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send application/json or text/plain');
    }
    const payload = req.body as unknown;
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null);

    const content = renderWebhookContent(payload, hook.template);
    const payloadBytes = Buffer.byteLength(rawBody);
    // A template always yields literal text (even "****"); only template-free bodies can be blank.
    if (!hook.template && isBlankContent(content)) {
      await recordDelivery(hook.id, { status: 'ignored', error: 'Rendered content was empty', payloadBytes }).catch(() => {});
      throw new HttpError(422, 'EMPTY_CONTENT', 'The payload rendered an empty message');
    }

    const [channel] = await db.select().from(channels).where(eq(channels.id, hook.channelId));
    if (!channel) notFoundWebhook();

    const { inserted } = await postMessage({
      target: { kind: 'channel', channel },
      author: { id: hook.botUserId, displayName: hook.name },
      content,
      silenced: [hook.botUserId],
    });

    void db.update(webhooks).set({ lastUsedAt: new Date() }).where(eq(webhooks.id, hook.id))
      .then(() => recordDelivery(hook.id, { status: 'ok', messageId: inserted.id, payloadBytes }))
      .catch((err) => req.log.warn({ err }, 'webhook bookkeeping failed'));

    if (hook.notify) {
      const recipients = await announceRecipients(channel.id, hook.workspaceId, [hook.botUserId]);
      const at = inserted.createdAt.toISOString();
      const snippet = plainSnippet(content);
      for (const userId of recipients) {
        hub.sendToUser(userId, {
          type: 'notification',
          notification: {
            kind: 'webhook',
            messageId: inserted.id,
            channelId: channel.id,
            conversationId: null,
            workspaceId: hook.workspaceId,
            channelName: channel.name,
            authorName: hook.name,
            snippet,
            at,
            unreadMentions: (await unreadTotal(userId, await workspaceIdsOf(userId))).mentions,
          },
        });
      }
      await sendPushToUsers(recipients, {
        title: `${hook.name} posted in #${channel.name}`,
        body: snippet,
        url: `${env.APP_URL}/w/${hook.workspaceId}/c/${channel.id}?m=${inserted.id}`,
        tag: `channel-${channel.id}`,
      });
    }

    return reply.code(201).send({ ok: true, messageId: inserted.id });
  });
}

/** Admin management of a workspace's webhooks (owners and admins only). */
export default async function webhookAdminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/workspaces/:workspaceId/webhooks', async (req) => {
    const me = requireUser(req);
    const { workspaceId } = workspaceParams.parse(req.params);
    await assertWorkspaceAdmin(workspaceId, me.id);
    const rows = await db
      .select()
      .from(webhooks)
      .where(eq(webhooks.workspaceId, workspaceId))
      .orderBy(webhooks.createdAt);
    return { webhooks: rows.map((r) => toWebhookDto(r)) };
  });

  app.post('/workspaces/:workspaceId/webhooks', async (req, reply) => {
    const me = requireUser(req);
    const { workspaceId } = workspaceParams.parse(req.params);
    await assertWorkspaceAdmin(workspaceId, me.id);
    const body = z.object({
      channelId: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      template: z.string().max(4000).nullish(),
      notify: z.boolean().default(false),
    }).parse(req.body);

    const [channel] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, body.channelId), eq(channels.workspaceId, workspaceId)));
    if (!channel) throw notFound('Channel not found in this workspace');

    const bot = await createWebhookBot(workspaceId, body.name);
    const token = newRefreshToken();
    const [created] = await db
      .insert(webhooks)
      .values({
        channelId: channel.id,
        workspaceId,
        botUserId: bot.id,
        createdBy: me.id,
        name: body.name,
        tokenHash: hashToken(token),
        template: body.template?.trim() ? body.template : null,
        notify: body.notify,
      })
      .returning();
    return reply.code(201).send({ webhook: toWebhookDto(created, token) });
  });

  app.patch('/webhooks/:webhookId', async (req) => {
    const me = requireUser(req);
    const { webhookId } = webhookParams.parse(req.params);
    const hook = await assertWebhookAdmin(webhookId, me.id);
    const body = z.object({
      name: z.string().trim().min(1).max(80).optional(),
      template: z.string().max(4000).nullable().optional(),
      notify: z.boolean().optional(),
      disabled: z.boolean().optional(),
    }).parse(req.body);

    const [updated] = await db
      .update(webhooks)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.template !== undefined ? { template: body.template?.trim() ? body.template : null } : {}),
        ...(body.notify !== undefined ? { notify: body.notify } : {}),
        ...(body.disabled !== undefined ? { disabledAt: body.disabled ? new Date() : null } : {}),
      })
      .where(eq(webhooks.id, hook.id))
      .returning();
    if (body.name !== undefined) {
      await db.update(users).set({ displayName: body.name }).where(eq(users.id, hook.botUserId));
    }
    return { webhook: toWebhookDto(updated) };
  });

  app.post('/webhooks/:webhookId/rotate', async (req) => {
    const me = requireUser(req);
    const { webhookId } = webhookParams.parse(req.params);
    const hook = await assertWebhookAdmin(webhookId, me.id);
    const token = newRefreshToken();
    await db.update(webhooks).set({ tokenHash: hashToken(token) }).where(eq(webhooks.id, hook.id));
    return { webhook: toWebhookDto(hook, token) };
  });

  app.delete('/webhooks/:webhookId', async (req) => {
    const me = requireUser(req);
    const { webhookId } = webhookParams.parse(req.params);
    const hook = await assertWebhookAdmin(webhookId, me.id);
    // The bot user and its messages stay so the channel history keeps rendering after removal.
    await db.delete(webhooks).where(eq(webhooks.id, hook.id));
    return { ok: true };
  });
}
