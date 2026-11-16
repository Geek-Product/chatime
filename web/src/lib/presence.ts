const online = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<string> = new Set();

export function setOnlineUser(userId: string, isOnline: boolean) {
  if (isOnline === online.has(userId)) return;
  if (isOnline) online.add(userId);
  else online.delete(userId);
  snapshot = new Set(online);
  for (const l of listeners) l();
}

/** Replaces the whole set from the server's `hello` snapshot, dropping anyone who left while disconnected. */
export function replaceOnlineUsers(userIds: string[]) {
  if (userIds.length === online.size && userIds.every((id) => online.has(id))) return;
  online.clear();
  for (const id of userIds) online.add(id);
  snapshot = new Set(online);
  for (const l of listeners) l();
}

/** Session ended: nobody is known to be online until the next `hello`. */
export function resetPresence() {
  if (online.size === 0) return;
  online.clear();
  snapshot = new Set();
  for (const l of listeners) l();
}

export function onlineUsers(): ReadonlySet<string> {
  return snapshot;
}

export function subscribePresence(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
