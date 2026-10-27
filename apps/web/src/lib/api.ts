import type {
  AccountSnapshot,
  FvDisplaySnapshot,
  MarketSnapshot,
  OrderResult,
} from '@euroedge/shared';

/** Same-origin API client (Caddy routes /api to the api service, ADR-0012). */
export class ApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code: string; message: string };
  };
  if (!res.ok)
    throw new ApiError(
      body.error?.code ?? String(res.status),
      body.error?.message ?? res.statusText,
    );
  return body as T;
}

export interface Session {
  readonly account: string | null;
  readonly devLogin: boolean;
  readonly tier: 'sim' | 'replay' | 'live-min';
}

export interface FvPoint {
  readonly t: number;
  readonly fv: string;
  readonly bandLo: string;
  readonly bandHi: string;
  readonly mark: string;
  readonly window: string;
}

export const api = {
  session: () => call<Session>('/api/session'),
  devLogin: (name?: string) =>
    call<{ account: string }>('/api/dev/login', {
      method: 'POST',
      body: JSON.stringify(name === undefined ? {} : { name }),
    }),
  logout: () => call<{ account: null }>('/api/dev/logout', { method: 'POST', body: '{}' }),
  market: (id: string) =>
    call<{ market: MarketSnapshot; fv: FvDisplaySnapshot | null }>(`/api/markets/${id}`),
  fvHistory: (id: string, minutes = 120) =>
    call<{ points: FvPoint[] }>(`/api/markets/${id}/fv?minutes=${minutes}`),
  account: () => call<AccountSnapshot>('/api/account'),
  placeOrder: (o: { market: string; side: 'buy' | 'sell'; size: string; reduceOnly?: boolean }) =>
    call<OrderResult>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ ...o, idempotencyKey: crypto.randomUUID() }),
    }),
  close: (market: string) =>
    call<OrderResult>(`/api/positions/${market}/close`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    }),
};
