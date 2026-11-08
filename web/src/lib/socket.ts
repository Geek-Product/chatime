import { onTokenRefreshed } from './api';
import type { ServerEvent } from './types';

type Listener = (event: ServerEvent) => void;

type Status = 'idle' | 'connecting' | 'open';

class SocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private getToken: () => string | null = () => null;
  /** Renews the access token if it is near expiry; `false` means there is no usable session. */
  private refreshIfNeeded: () => Promise<boolean> = async () => true;
  private verifying = false;
  private attempt = 0;
  private reconnectTimer: number | undefined;
  private heartbeat: number | undefined;
  private stopped = true;
  private status: Status = 'idle';

  start(getToken: () => string | null, refreshIfNeeded?: () => Promise<boolean>) {
    this.getToken = getToken;
    this.refreshIfNeeded = refreshIfNeeded ?? (async () => true);
    // Rendering the waiting screen then the chat starts the shared client twice; the second
    // call must not tear down the live socket or stack another token subscription.
    if (!this.stopped) return;
    this.stopped = false;
    // The server may reject long-lived sockets after the token rotates; reconnect with the new one.
    onTokenRefreshed(() => this.reconnect());
    this.restart();
  }

  /** Reconnect now (dropping any backoff). A socket still connecting is left alone to avoid churn. */
  restart() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    if (this.status === 'open') this.reconnect();
    else if (this.status === 'idle') this.connect();
  }

  stop() {
    this.stopped = true;
    this.listeners.clear();
    this.verifying = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    const ws = this.ws;
    this.ws = null;
    this.status = 'idle';
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private reconnect() {
    const ws = this.ws;
    if (this.stopped || !ws) return;
    this.status = 'idle';
    this.ws = null;
    ws.onclose = null;
    ws.close();
    clearInterval(this.heartbeat);
    this.attempt = 0;
    this.connect();
  }

  private connect() {
    if (this.stopped) return;
    if (!this.getToken()) return;
    // The token check is async; open the handshake only after it. Extra start() calls
    // while it runs are dropped (the result opens the socket anyway).
    if (this.verifying) return;
    this.verifying = true;
    this.status = 'connecting';
    void this.refreshIfNeeded().then((ok) => {
      this.verifying = false;
      if (this.stopped) return;
      if (this.status !== 'connecting') return;
      if (ok) this.open(this.getToken()!);
      else this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
    });
  }

  /** The server reads the token from the URL, so it must be renewed before the handshake. */
  private open(token: string) {
    const base = import.meta.env.DEV ? import.meta.env.VITE_API_URL ?? 'http://localhost:4000' : location.origin;
    const url = new URL(base);
    const proto = url.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${url.host}/api/ws?token=${encodeURIComponent(this.getToken() ?? token)}`);
    this.ws = ws;
    this.status = 'connecting';

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.status = 'open';
      this.attempt = 0;
      clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => this.send({ type: 'pong' }), 25_000);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      try {
        const event = JSON.parse(ev.data) as ServerEvent;
        // The server drops sockets that never answer its heartbeat.
        if ((event as { type: string }).type === 'ping') {
          this.send({ type: 'pong' });
          return;
        }
        for (const fn of this.listeners) fn(event);
      } catch {
        /* ignore */
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.status = 'idle';
      clearInterval(this.heartbeat);
      if (this.stopped) return;
      // 4001 = token rejected; retry after the client has had a chance to refresh.
      const delay = Math.min(30_000, 500 * 2 ** this.attempt++);
      this.reconnectTimer = window.setTimeout(() => this.connect(), ev.code === 4001 ? 3000 : delay);
    };
  }

  send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

export const socket = new SocketClient();
