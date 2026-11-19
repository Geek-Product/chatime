import type { User } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

interface TokenState {
  accessToken: string | null;
  onRefreshed: () => void;
}

const token: TokenState = { accessToken: null, onRefreshed: () => {} };
let refreshing: Promise<string | null> | null = null;
let tokenExpiresAt = 0;
let lastRefreshFailure: 'network' | 'server' | 'auth' | null = null;

const SESSION_USER_KEY = 'tc.session.user.v1';

function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function rememberUser(user: User) {
  try {
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  } catch {
    // Storage can be unavailable (private mode); offline sign-in simply won't work there.
  }
}

/** Drops the cached account so another login on this browser cannot see offline data. */
function forgetCachedUser() {
  try {
    localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    // ignore
  }
}

export const setAccessToken = (t: string | null) => {
  token.accessToken = t;
};
export const getAccessToken = () => token.accessToken;
/** Expiry of the current access token; unknown expiry (0) counts as expiring so callers renew. */
export const accessTokenExpiringSoon = () => tokenExpiresAt === 0 || Date.now() > tokenExpiresAt - 60_000;

/** Store a token handed out by login/register together with its lifetime, so expiry checks work. */
export function applySession(res: AuthResponse) {
  token.accessToken = res.accessToken;
  tokenExpiresAt = Date.now() + res.expiresIn * 1000;
  rememberUser(res.user);
}

/**
 * For code that reconnects on its own schedule (the WebSocket): renew only when the token is about
 * to expire. Refreshing rotates the refresh cookie, so doing it on every reconnect races other tabs.
 */
export async function ensureFreshAccessToken(): Promise<boolean> {
  if (token.accessToken && !accessTokenExpiringSoon()) return true;
  return Boolean(await refresh());
}
export const onTokenRefreshed = (fn: () => void) => {
  token.onRefreshed = fn;
};

export async function refreshSession(): Promise<string | null> {
  return refresh();
}

let lastRefreshedUser: User | null = null;

/** The user record returned by the most recent `/auth/refresh`. */
export function refreshedUser() {
  return lastRefreshedUser;
}

async function refresh(): Promise<string | null> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) {
        // 401/403 means the session is really gone; 5xx means the server is just unavailable.
        lastRefreshFailure = r.status >= 500 ? 'server' : 'auth';
        return null;
      }
      const data = (await r.json()) as { accessToken: string; expiresIn: number; user?: User };
      token.accessToken = data.accessToken;
      tokenExpiresAt = Date.now() + data.expiresIn * 1000;
      lastRefreshedUser = data.user ?? null;
      lastRefreshFailure = null;
      if (data.user) rememberUser(data.user);
      token.onRefreshed();
      return data.accessToken;
    })
    .catch(() => {
      lastRefreshFailure = 'network';
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  expiresIn: number;
}

export async function bootstrapSession(): Promise<AuthResponse | null> {
  const accessToken = await refresh();
  const expiresIn = Math.max(0, Math.round((tokenExpiresAt - Date.now()) / 1000));
  if (!accessToken) {
    // Offline or a server outage is not a sign-out: reuse the last account so cached chats
    // stay readable. A real 401/403 from refresh still lands on the login screen.
    if (lastRefreshFailure !== 'auth') {
      const cached = readCachedUser();
      if (cached) return { accessToken: '', expiresIn: 0, user: cached };
    }
    return null;
  }
  try {
    const me = await request<{ user: AuthResponse['user'] }>('/auth/me');
    rememberUser(me.user);
    return { accessToken, expiresIn, user: me.user };
  } catch (error) {
    const cached = readCachedUser();
    const unavailable = error instanceof TypeError || (error instanceof ApiError && error.status >= 500);
    if (cached && unavailable) return { accessToken, expiresIn, user: cached };
    return null;
  }
}

async function rawRequest(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (token.accessToken) headers.set('authorization', `Bearer ${token.accessToken}`);
  return fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
}

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  let res = await rawRequest(path, init);
  if (res.status === 401 && retry) {
    const fresh = await refresh();
    if (fresh) res = await rawRequest(path, init);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? 'Request failed');
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    // init.body carries `content-type: application/json`, so a bare string must still be JSON-encoded.
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  // Sends `{}` so the request isn't a JSON content-type with an empty body, which Fastify rejects.
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: JSON.stringify(body ?? {}) }),
};

export function authTokenQuery() {
  const t = token.accessToken;
  return t ? `?token=${encodeURIComponent(t)}` : '';
}

/** URL for images the browser loads directly (`<img src>`); appends the access token as a query param. */
export function assetUrl(path: string) {
  const t = token.accessToken;
  if (!t) return path;
  return `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`;
}

/** Uploads one file; `onProgress` reports 0..1 while the body streams. */
export function uploadAttachment(file: File, onProgress?: (fraction: number) => void): Promise<import('./types').Attachment> {
  const send = (retry: boolean) =>
    new Promise<import('./types').Attachment>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/attachments');
      xhr.withCredentials = true;
      if (token.accessToken) xhr.setRequestHeader('authorization', `Bearer ${token.accessToken}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.min(0.99, e.loaded / e.total));
      };
      xhr.onerror = () => reject(new ApiError(0, 'NETWORK', 'Upload failed'));
      xhr.onload = async () => {
        if (xhr.status === 401 && retry && (await refresh())) {
          send(false).then(resolve, reject);
          return;
        }
        let data: { attachment?: import('./types').Attachment; error?: { code?: string; message?: string } } | null = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300 && data?.attachment) {
          onProgress?.(1);
          resolve(data.attachment);
        } else {
          reject(new ApiError(xhr.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Upload failed'));
        }
      };
      const form = new FormData();
      form.append('file', file, file.name);
      xhr.send(form);
    });
  return send(true);
}

export async function downloadAttachment(url: string, filename: string) {
  const res = await rawRequest(url.replace(/^\/api/, ''), {});
  if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Download failed');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Capped at 1 MB: code previews never need more, and decoding a huge text file blocks the main thread. */
export const MAX_PREVIEW_BYTES = 1024 * 1024;

/** Fetches an attachment as UTF-8 text for the code preview. */
export async function fetchAttachmentText(url: string) {
  let res = await rawRequest(url.replace(/^\/api/, ''), {});
  if (res.status === 401 && (await refresh())) res = await rawRequest(url.replace(/^\/api/, ''), {});
  if (!res.ok) throw new ApiError(res.status, 'ERROR', 'Could not load file');
  if (Number(res.headers.get('content-length') ?? 0) > MAX_PREVIEW_BYTES) {
    throw new ApiError(413, 'TOO_LARGE', 'File is too large to preview');
  }
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_PREVIEW_BYTES) throw new ApiError(413, 'TOO_LARGE', 'File is too large to preview');
  return new TextDecoder('utf-8').decode(buffer);
}

export async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } finally {
    // Signing out must work offline too, so local state is dropped even if the request failed.
    token.accessToken = null;
    lastRefreshedUser = null;
    forgetCachedUser();
  }
}
