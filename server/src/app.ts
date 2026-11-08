import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { eq, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import { env } from '../env';
import { db } from './db/index';
import { users } from './db/schema';
import { MAX_UPLOAD_BYTES } from './lib/attachments';
import { HttpError } from './lib/errors';
import { hub } from './lib/hub';
import accessRoutes from './routes/access';
import attachmentRoutes from './routes/attachments';
import authRoutes from './routes/auth';
import channelRoutes from './routes/channels';
import conversationRoutes from './routes/conversations';
import messageRoutes from './routes/messages';
import notificationRoutes from './routes/notifications';
import pushRoutes from './routes/push';
import workspaceRoutes from './routes/workspaces';
import wsRoutes from './routes/ws';

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'warn' },
  });

  app.decorate('findUserById', async (id: string) => {
    const [u] = await db.select().from(users).where(eq(users.id, id));
    if (!u) return null;
    return { id: u.id, email: u.email, username: u.username, displayName: u.displayName, avatarColor: u.avatarColor };
  });

  // Older deployments had messages.channel_id NOT NULL; DMs need it nullable.
  await db.execute(sql`alter table messages alter column channel_id drop not null`).catch(() => {});

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // In production the SPA is served from this server; the Vite dev server needs CORS.
  if (env.NODE_ENV !== 'production') {
    await app.register(cors, { origin: env.CLIENT_ORIGIN, credentials: true });
  }
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 2 } });
  await app.register(websocket);

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      const message = err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: (err as Error).message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(async (scope) => {
    await scope.register(authRoutes);
    await scope.register(accessRoutes);
    await scope.register(workspaceRoutes);
    await scope.register(channelRoutes);
    await scope.register(conversationRoutes);
    await scope.register(messageRoutes);
    await scope.register(notificationRoutes);
    await scope.register(pushRoutes);
    await scope.register(attachmentRoutes);
  }, { prefix: '/api' });

  await app.register(wsRoutes, { prefix: '/api' });

  const webDist = path.resolve(import.meta.dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api')) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
      }
      return reply.sendFile('index.html');
    });
  }

  hub.onPresenceChange((userId, online) => {
    hub.broadcastToUsers(hub.onlineUsers(), { type: 'presence', userId, online });
  });

  const heartbeat = setInterval(() => hub.pingAll(), 30_000);
  heartbeat.unref();
  app.addHook('onClose', async () => clearInterval(heartbeat));

  return app;
}
