import type { MarketUnits, Ticks, Usdc } from '@euroedge/fixed';
import { Ledger } from '@euroedge/ledger';
import type { Position } from '@euroedge/risk-core';
import type { AccountId, BreakerEffect, MarketId, Side, WindowId, WindowRisk } from './events.ts';

export interface MarketData {
  readonly window: WindowId;
  readonly fv: Ticks;
  readonly bandLo: Ticks;
  readonly bandHi: Ticks;
  readonly index: Ticks;
  readonly mark: Ticks;
  readonly sigmaPpm: bigint;
  readonly breaker: BreakerEffect;
  readonly ts: bigint;
}

export interface MarketState {
  readonly id: MarketId;
  readonly kind: 'stock' | 'basket';
  readonly units: MarketUnits;
  readonly minNotional: Usdc;
  readonly maintenanceMarginBps: bigint;
  readonly liquidationPenaltyBps: bigint;
  readonly windows: Readonly<Record<WindowId, WindowRisk>>;
  data: MarketData | undefined;
  readonly fundingInterestBpsPerYear: bigint;
  readonly partialLiquidationBufferBps: bigint | null;
  /** Funding (ADR-0016): last settled hour (event-time hours since epoch) and cumulative rate. */
  funding: { lastHour: bigint; index: bigint; lastRate: bigint };
  /** House position = exact negative of all user positions (lots and cost). */
  house: Position;
}

export interface AccountState {
  readonly id: AccountId;
  readonly positions: Map<MarketId, Position>;
}

export type RejectReason =
  | 'not-genesis'
  | 'unknown-market'
  | 'no-market-data'
  | 'unknown-account'
  | 'reduce-only'
  | 'reduce-only-window'
  | 'price-limit'
  | 'min-notional'
  | 'insufficient-margin'
  | 'no-position'
  | 'circuit-breaker'
  | 'not-marketable'
  | 'invalid-price'
  | 'too-many-orders'
  | 'unknown-order';

export interface Fill {
  readonly market: MarketId;
  readonly side: Side;
  readonly qty: bigint;
  readonly price: Ticks;
  readonly fee: Usdc;
  /** Realized PnL of this fill, µUSDC. */
  readonly realized: Usdc;
}

export type OrderOutcome =
  | { readonly status: 'filled'; readonly fill: Fill }
  | { readonly status: 'accepted'; readonly orderId: string }
  | { readonly status: 'rejected'; readonly reason: RejectReason };

/** A resting limit order (GTC, full fills only, against the house quote). */
export interface RestingOrder {
  readonly orderId: string;
  readonly requestId: string;
  readonly account: AccountId;
  readonly market: MarketId;
  /** Signed lots: + buy, − sell. */
  readonly qty: bigint;
  readonly limitPrice: bigint;
  readonly reduceOnly: boolean;
}

export interface EngineState {
  seq: bigint;
  ts: bigint;
  genesis: boolean;
  /** Genesis + deposits − executed withdrawals, tracked independently of the ledger (Invariant 1). */
  netDeposits: bigint;
  readonly markets: Map<MarketId, MarketState>;
  readonly accounts: Map<AccountId, AccountState>;
  readonly ledger: Ledger;
  /** `${account}:${idempotencyKey}` → first outcome (replayed for duplicates). */
  readonly idempotency: Map<string, OrderOutcome>;
  /** `${account}:${orderId}` → resting limit order, matched in insertion (time) order. */
  readonly orders: Map<string, RestingOrder>;
}

export function createState(): EngineState {
  return {
    seq: 0n,
    ts: 0n,
    genesis: false,
    netDeposits: 0n,
    markets: new Map(),
    accounts: new Map(),
    ledger: new Ledger(),
    idempotency: new Map(),
    orders: new Map(),
  };
}
