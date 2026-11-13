import type { WebSocket } from 'ws';

export type ServerEvent =
  | { type: 'hello'; userId: string; workspaceIds: string[]; online: string[]; unread: { unread: number; mentions: number } }
  | { type: 'message.created'; message: unknown; parentReplyCount?: number }
  | { type: 'message.updated'; message: unknown }
  | { type: 'message.deleted'; channelId: string | null; conversationId?: string | null; id: string; parentId: string | null; parentReplyCount?: number }
  | { type: 'reaction.updated'; messageId: string; reactions: unknown[] }
  | { type: 'channel.created'; channel: unknown }
  | { type: 'channel.updated'; channel: unknown }
  | { type: 'conversation.created'; conversation: unknown }
  | { type: 'presence'; userId: string; online: boolean }
  | { type: 'member.joined'; workspaceId: string; user: unknown }
  | { type: 'member.role_changed'; workspaceId: string; userId: string; role: 'owner' | 'admin' | 'member' }
  | { type: 'user.updated'; user: { id: string; username: string; displayName: string; title: string | null; avatarColor: string } }
  | { type: 'notification'; notification: unknown }
  | { type: 'access.changed'; status: 'approved' | 'declined'; workspaceId: string }
  | { type: 'pong' };

type Client = { socket: WebSocket; workspaceIds: Set<string>; alive: boolean };

class Hub {
  private clients = new Map<string, Set<Client>>();

  private presenceListeners = new Set<(userId: string, online: boolean) => void>();

  onPresenceChange(fn: (userId: string, online: boolean) => void) {
    this.presenceListeners.add(fn);
  }

  add(userId: string, socket: WebSocket, workspaceIds: string[]): Client {
    const wasOffline = !this.isOnline(userId);
    const client: Client = { socket, workspaceIds: new Set(workspaceIds), alive: true };
    let set = this.clients.get(userId);
    if (!set) this.clients.set(userId, (set = new Set()));
    set.add(client);
    if (wasOffline) for (const fn of this.presenceListeners) fn(userId, true);
    return client;
  }

  remove(userId: string, client: Client) {
    const set = this.clients.get(userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) {
      this.clients.delete(userId);
      for (const fn of this.presenceListeners) fn(userId, false);
    }
  }

  isOnline(userId: string) {
    return (this.clients.get(userId)?.size ?? 0) > 0;
  }

  onlineUsers() {
    return [...this.clients.keys()];
  }

  sendToUser(userId: string, event: ServerEvent) {
    const data = JSON.stringify(event);
    for (const c of this.clients.get(userId) ?? []) {
      if (c.socket.readyState === c.socket.OPEN) c.socket.send(data);
    }
  }

  broadcastToWorkspace(workspaceId: string, event: ServerEvent | ((userId: string) => Promise<ServerEvent>)) {
    const staticData = typeof event === 'function' ? null : JSON.stringify(event);
    for (const [userId, set] of this.clients) {
      const recipients = [...set].filter(
        (c) => c.workspaceIds.has(workspaceId) && c.socket.readyState === c.socket.OPEN,
      );
      if (recipients.length === 0) continue;
      if (staticData) {
        for (const c of recipients) c.socket.send(staticData);
      } else {
        (event as (userId: string) => Promise<ServerEvent>)(userId)
          .then((e) => {
            const data = JSON.stringify(e);
            for (const c of recipients) if (c.socket.readyState === c.socket.OPEN) c.socket.send(data);
          })
          .catch(() => {});
      }
    }
  }

  broadcastToUsers(userIds: string[], event: ServerEvent) {
    for (const id of userIds) this.sendToUser(id, event);
  }

  /** Per-recipient view, as with broadcastToWorkspace but for an explicit audience (DMs). */
  broadcastPerUser(userIds: string[], build: (userId: string) => Promise<ServerEvent>) {
    for (const id of new Set(userIds)) {
      if (!this.isOnline(id)) continue;
      build(id).then((e) => this.sendToUser(id, e)).catch(() => {});
    }
  }

  pingAll() {
    for (const set of this.clients.values()) {
      for (const c of set) {
        if (!c.alive) {
          c.socket.terminate();
          continue;
        }
        c.alive = false;
        if (c.socket.readyState === c.socket.OPEN) c.socket.ping();
      }
    }
  }
}

export const hub = new Hub();
