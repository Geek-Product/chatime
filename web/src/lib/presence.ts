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

export function onlineUsers(): ReadonlySet<string> {
  return snapshot;
}

export function subscribePresence(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
