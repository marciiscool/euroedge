'use client';

import { useEffect, useRef, useState } from 'react';

type Listener = (data: unknown) => void;

/**
 * One WebSocket per tab with auto-reconnect (M1). A SharedWorker across tabs, seq/gap
 * resync and rAF batching arrive in M6/M7.
 */
class LiveClient {
  private ws: WebSocket | undefined;
  private readonly listeners = new Map<string, Set<Listener>>();
  private retry = 0;
  private closed = false;
  status: 'connecting' | 'open' | 'closed' = 'connecting';
  private readonly statusListeners = new Set<(s: LiveClient['status']) => void>();

  connect(): void {
    if (typeof window === 'undefined') return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      for (const ch of this.listeners.keys()) ws.send(JSON.stringify({ op: 'sub', ch }));
    };
    ws.onmessage = (ev: MessageEvent<string>) => {
      const msg = JSON.parse(ev.data) as { ch?: string; data?: unknown };
      if (msg.ch === undefined) return;
      const key = msg.ch.startsWith('account:') ? 'account' : msg.ch;
      for (const l of this.listeners.get(key) ?? []) l(msg.data);
    };
    ws.onclose = () => {
      this.setStatus('closed');
      if (this.closed) return;
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => this.connect(), delay);
    };
  }

  subscribe(ch: string, l: Listener): () => void {
    let set = this.listeners.get(ch);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(ch, set);
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op: 'sub', ch }));
    }
    set.add(l);
    return () => set.delete(l);
  }

  /** Re-sends subscriptions (e.g. after login, so `account` binds to the new session). */
  reconnect(): void {
    this.ws?.close();
  }

  onStatus(l: (s: LiveClient['status']) => void): () => void {
    this.statusListeners.add(l);
    return () => this.statusListeners.delete(l);
  }

  private setStatus(s: LiveClient['status']) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }
}

let client: LiveClient | undefined;
export function live(): LiveClient {
  if (client === undefined) {
    client = new LiveClient();
    client.connect();
  }
  return client;
}

/** Latest value on a channel (re-renders on every message; fine at 1 Hz). */
export function useChannel<T>(ch: string, initial?: T): T | undefined {
  // Values are tagged with their channel so a switch never shows the previous channel's data.
  const [state, setState] = useState<{ ch: string; value: T | undefined }>({ ch, value: initial });
  useEffect(() => live().subscribe(ch, (d) => setState({ ch, value: d as T })), [ch]);
  return state.ch === ch ? state.value : undefined;
}

export function useLiveStatus(): LiveClient['status'] {
  const [s, setS] = useState<LiveClient['status']>('connecting');
  const ref = useRef(false);
  useEffect(() => {
    if (!ref.current) {
      ref.current = true;
      setS(live().status);
    }
    return live().onStatus(setS);
  }, []);
  return s;
}
