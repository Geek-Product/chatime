import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getWorkspaceIdsForUser } from '../lib/access';
import { verifyAccessToken } from '../lib/auth';
import { hub } from '../lib/hub';
import { unreadTotal } from '../lib/unread';

export default async function wsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const { token } = z.object({ token: z.string().optional() }).parse(req.query);
    const userId = token ? await verifyAccessToken(token) : null;
    if (!userId) {
      socket.close(4001, 'Unauthorized');
      return;
    }
    const user = await app.findUserById(userId);
    if (!user) {
      socket.close(4001, 'Unauthorized');
      return;
    }

    const workspaceIds = await getWorkspaceIdsForUser(userId);
    const client = hub.add(userId, socket, workspaceIds);

    socket.on('pong', () => { client.alive = true; });
    socket.on('message', (raw) => {
      client.alive = true;
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // ignore malformed frames
      }
    });
    socket.on('close', () => hub.remove(userId, client));
    socket.on('error', () => hub.remove(userId, client));

    const counts = await unreadTotal(userId, workspaceIds);
    socket.send(JSON.stringify({ type: 'hello', userId, workspaceIds, unread: counts, online: hub.onlineUsers() }));
  });
}
