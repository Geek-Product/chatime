import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../env';
import { db } from '../db/index';
import { pushSubscriptions } from '../db/schema';
import { authenticate, requireUser } from '../lib/auth';
import { pushEnabled } from '../lib/push';

const subscriptionBody = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

export default async function pushRoutes(app: FastifyInstance) {
  app.get('/push/key', async () => ({
    publicKey: env.VAPID_PUBLIC_KEY ?? null,
    enabled: pushEnabled,
  }));

  app.addHook('preHandler', authenticate);

  app.post('/push/subscribe', async (req, reply) => {
    const me = requireUser(req);
    if (!pushEnabled) return reply.code(503).send({ error: { code: 'PUSH_DISABLED', message: 'Push is not configured on the server' } });
    const body = subscriptionBody.parse(req.body);
    await db
      .insert(pushSubscriptions)
      .values({
        userId: me.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: req.headers['user-agent'] ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: me.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
      });
    return { ok: true };
  });

  app.delete('/push/subscribe', async (req) => {
    const me = requireUser(req);
    const body = z.object({ endpoint: z.string().url().max(1000) }).parse(req.body);
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.userId, me.id)));
    return { ok: true };
  });
}
