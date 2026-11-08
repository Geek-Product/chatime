import { useSyncExternalStore } from 'react';
import { onlineUsers, subscribePresence } from './presence';

export function useOnlineUsers(): ReadonlySet<string> {
  return useSyncExternalStore(subscribePresence, onlineUsers);
}

export function useOnline(userId: string): boolean {
  return useSyncExternalStore(subscribePresence, () => onlineUsers().has(userId));
}
