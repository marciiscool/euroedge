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

export type ChainInfo =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly chainId: number;
      readonly token: `0x${string}`;
      readonly vault: `0x${string}`;
    };

export interface Withdrawal {
  readonly id: string;
  readonly amount: string;
  readonly nonce: string;
  readonly status: 'pending' | 'executed' | 'expired';
  readonly authorisation: {
    readonly deadlineSec: string;
    readonly signature: `0x${string}`;
  } | null;
}

export interface RelayBody {
  readonly user: string;
  readonly amount: string;
  readonly deadline: string;
  readonly signature: string;
  readonly nonce?: string;
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
  logout: () => call<{ account: null }>('/api/auth/logout', { method: 'POST', body: '{}' }),
  nonce: () => call<{ nonce: string; domain: string; chainId: number }>('/api/auth/nonce'),
  siwe: (message: string, signature: string) =>
    call<{ account: string }>('/api/auth/siwe', {
      method: 'POST',
      body: JSON.stringify({ message, signature }),
    }),
  market: (id: string) =>
    call<{ market: MarketSnapshot; fv: FvDisplaySnapshot | null }>(`/api/markets/${id}`),
  fvHistory: (id: string, minutes = 120) =>
    call<{ points: FvPoint[] }>(`/api/markets/${id}/fv?minutes=${minutes}`),
  account: () => call<AccountSnapshot>('/api/account'),
  chain: () => call<ChainInfo>('/api/chain'),
  withdrawals: () => call<{ withdrawals: Withdrawal[] }>('/api/withdrawals'),
  requestWithdrawal: (amount: bigint) =>
    call<{ withdrawalId: string }>('/api/withdrawals', {
      method: 'POST',
      body: JSON.stringify({ amount: amount.toString(), idempotencyKey: crypto.randomUUID() }),
    }),
  /** Gasless relays (M5-11): the relayer pays gas, the user (or engine signer) signed. */
  relay: (kind: 'claim' | 'deposit' | 'withdraw', body: RelayBody) =>
    call<{ txHash: `0x${string}` }>(`/relay/${kind}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  placeOrder: (o: {
    market: string;
    side: 'buy' | 'sell';
    size: string;
    reduceOnly?: boolean;
    type?: 'market' | 'limit';
    limitPrice?: string;
  }) =>
    call<OrderResult>('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ ...o, idempotencyKey: crypto.randomUUID() }),
    }),
  cancelOrder: (orderId: string) =>
    call<OrderResult>(`/api/orders/${orderId}`, { method: 'DELETE', body: '{}' }),
  close: (market: string) =>
    call<OrderResult>(`/api/positions/${market}/close`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    }),
};
