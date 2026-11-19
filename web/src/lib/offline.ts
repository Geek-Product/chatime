import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query';

const STORAGE_KEY = 'tc.offline.queries.v1';
/** localStorage quotas are ~5 MB; stay well below it and keep the newest queries. */
const MAX_CHARS = 1_500_000;
const PERSISTED_QUERIES = new Set([
  'workspaces',
  'channels',
  'conversations',
  'members',
  'messages',
  'thread',
  'unread',
  'notifications',
]);

/** Loads the last successful snapshots before the first render. */
export function restoreOfflineCache(qc: QueryClient) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) hydrate(qc, JSON.parse(raw) as DehydratedState);
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be unavailable (private mode).
    }
  }
}

/** Mirrors successful chat queries to localStorage so a reload while offline still renders them. */
export function syncOfflineCache(qc: QueryClient) {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    try {
      const state = dehydrate(qc, {
        shouldDehydrateQuery: (query) =>
          query.state.status === 'success' && PERSISTED_QUERIES.has(String(query.queryKey[0])),
      });

      state.queries.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
      const kept: DehydratedState['queries'] = [];
      let used = 0;
      for (const query of state.queries) {
        const size = JSON.stringify(query).length;
        if (used + size > MAX_CHARS) break;
        kept.push(query);
        used += size;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mutations: [], queries: kept }));
    } catch {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage can be unavailable (private mode).
      }
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 1000);
  };

  const unsubscribe = qc.getQueryCache().subscribe(schedule);
  window.addEventListener('pagehide', save);

  return () => {
    clearTimeout(timer);
    unsubscribe();
    window.removeEventListener('pagehide', save);
  };
}

/** Called on sign-in and sign-out: cached messages are user-specific. */
export function clearOfflineCache(qc: QueryClient) {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode).
  }
  qc.clear();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => registration.active?.postMessage({ type: 'CLEAR_OFFLINE_DATA' }))
      .catch(() => {});
  }
}
