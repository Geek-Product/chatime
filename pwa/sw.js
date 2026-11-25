/* Team Chat service worker: app-shell/offline caching plus Web Push. */
const VERSION = 'v2';
const SHELL_CACHE = `chatime-shell-${VERSION}`;
const STATIC_CACHE = `chatime-static-${VERSION}`;
const API_CACHE = `chatime-api-${VERSION}`;
const OWNED_CACHES = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE]);

const SHELL_URLS = [
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

const STATIC_PREFIXES = ['/assets/', '/icons/', '/gifs/', '/stickers/'];
const API_PATTERNS = [
  /^\/api\/workspaces$/,
  /^\/api\/workspaces\/[^/]+\/(channels|conversations|members)$/,
  /^\/api\/channels\/[^/]+\/(messages|history)$/,
  /^\/api\/dms\/[^/]+\/(messages|history)$/,
  /^\/api\/messages\/[^/]+\/replies$/,
  /^\/api\/notifications\/mentions$/,
  /^\/api\/unread$/,
];
const MAX_API_ENTRIES = 200;
const MAX_STATIC_ENTRIES = 300;
const NETWORK_TIMEOUT_MS = 5000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Add individually so one missing file cannot fail the whole install.
      await Promise.all(SHELL_URLS.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('chatime-') && !OWNED_CACHES.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_OFFLINE_DATA') {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, { cacheKey: '/index.html' }));
    return;
  }

  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(networkFirst(request, STATIC_CACHE, { maxEntries: MAX_STATIC_ENTRIES }));
    return;
  }

  if (API_PATTERNS.some((pattern) => pattern.test(url.pathname))) {
    event.respondWith(networkFirst(request, API_CACHE, { maxEntries: MAX_API_ENTRIES }));
    return;
  }

  if (STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

async function fetchWithTimeout(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(request, cacheName, { cacheKey, maxEntries = 0 } = {}) {
  const cache = await caches.open(cacheName);
  const key = cacheKey ?? request;
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) {
      await cache.put(key, response.clone());
      if (maxEntries) await trim(cache, maxEntries);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:2rem"><h1>You are offline</h1><p>Open Team Chat once while online to save it for offline use.</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache, MAX_STATIC_ENTRIES);
  }
  return response;
}

/** Caches keep insertion order, so dropping the first keys evicts the oldest entries. */
async function trim(cache, maxEntries) {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Team Chat', body: event.data.text() };
  }
  event.waitUntil((async () => {
    await updateAppBadge(payload.badge);
    // Each device decides for itself: a focused window already renders the message live,
    // while a minimized, backgrounded or closed app still gets the system notification.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((client) => client.focused && client.visibilityState !== 'hidden')) return;
    await self.registration.showNotification(payload.title ?? 'Team Chat', {
      body: payload.body ?? '',
      tag: payload.tag,
      // Without this, a second message in the same channel would replace the first silently.
      renotify: Boolean(payload.tag),
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url ?? '/' },
    });
  })());
});

/** Badging API on the service worker registration (Chrome/Edge, Safari home-screen apps). */
async function updateAppBadge(count) {
  if (typeof count !== 'number') return;
  try {
    if (count > 0) await self.registration.setAppBadge?.(count);
    else await self.registration.clearAppBadge?.();
  } catch {
    /* badging unsupported */
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        // Focus can be denied (e.g. no window manager); a failed focus must not block navigation.
        await existing.focus().catch(() => {});
        try {
          await existing.navigate(target);
          return;
        } catch {
          /* fall through to a fresh window */
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
