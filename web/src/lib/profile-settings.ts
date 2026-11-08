import { useSyncExternalStore } from 'react';

/**
 * "Open settings on the Profile tab" requests, raised from outside ChatLayout
 * (the profile card sits under a provider above it, so it cannot call ChatLayout setters directly).
 */
let pending = 0;
const listeners = new Set<() => void>();

export function requestProfileSettings() {
  pending += 1;
  for (const fn of listeners) fn();
}

export function useProfileSettingsRequest() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => pending,
  );
}
