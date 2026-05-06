'use client';

import type { ClientMessage, ServerMessage } from '@stacks/shared-types';

type Listener = (msg: ServerMessage) => void;

export interface GameClient {
  state: 'connecting' | 'open' | 'closed' | 'reconnecting';
  send: (msg: Omit<ClientMessage, 'v'>) => Promise<ServerMessage>;
  on: (listener: Listener) => () => void;
  close: () => void;
}

export function connectGameServer(opts: {
  url: string;
  sessionToken: string;
  deviceFingerprint: string;
  userAgent: string;
}): GameClient {
  let ws: WebSocket | null = null;
  let state: GameClient['state'] = 'connecting';
  let helloSent = false;
  const listeners = new Set<Listener>();
  const pending = new Map<string, (m: ServerMessage) => void>();
  const messageBuffer: string[] = [];
  let backoff = 500;
  const MAX_BACKOFF = 8000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  function open() {
    state = 'connecting';
    ws = new WebSocket(opts.url);

    ws.onopen = () => {
      state = 'open';
      backoff = 500;
      // Hello first
      const helloId = crypto.randomUUID();
      const hello = JSON.stringify({
        v: 1,
        type: 'hello',
        id: helloId,
        payload: {
          sessionToken: opts.sessionToken,
          deviceFingerprint: opts.deviceFingerprint,
          userAgent: opts.userAgent.slice(0, 256),
        },
      });
      ws!.send(hello);
      helloSent = true;
      // Flush queued messages
      for (const m of messageBuffer) ws!.send(m);
      messageBuffer.length = 0;
      // Heartbeat
      if (pingTimer) clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ v: 1, type: 'ping', payload: { ts: Date.now() } }));
        }
      }, 25_000);
    };

    ws.onmessage = (e) => {
      let msg: ServerMessage | null = null;
      try { msg = JSON.parse(e.data as string); } catch { return; }
      if (!msg) return;
      const id = (msg as { id?: string }).id;
      if (id && pending.has(id)) {
        pending.get(id)!(msg);
        pending.delete(id);
      }
      for (const l of listeners) l(msg);
    };

    ws.onclose = () => {
      state = 'closed';
      if (pingTimer) clearInterval(pingTimer);
      if (stopped) return;
      // Reconnect with backoff
      state = 'reconnecting';
      reconnectTimer = setTimeout(open, backoff);
      backoff = Math.min(MAX_BACKOFF, Math.round(backoff * 1.7));
      helloSent = false;
    };

    ws.onerror = () => {
      try { ws?.close(); } catch {}
    };
  }

  open();

  return {
    get state() { return state; },
    send(msg) {
      const id = crypto.randomUUID();
      const payload = JSON.stringify({ v: 1, id, ...msg });
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, 15_000);
        pending.set(id, (m) => { clearTimeout(t); resolve(m); });
        if (ws && ws.readyState === WebSocket.OPEN && helloSent) {
          ws.send(payload);
        } else {
          messageBuffer.push(payload);
        }
      });
    },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      try { ws?.close(); } catch {}
    },
  };
}
