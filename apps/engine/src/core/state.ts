import type { MarketUnits, Ticks, Usdc } from '@euroedge/fixed';
import { Ledger } from '@euroedge/ledger';
import type { Position } from '@euroedge/risk-core';
import type {
  AccountId,
  BreakerEffect,
  FlowParams,
  MarketId,
  Side,
  WindowId,
  WindowRisk,
} from './events.ts';

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
  readonly flowParams: FlowParams;
  /** Decayed net user flow (µUSDC) as of `sec`, and per-wallet usage in window `window`. */
  readonly flow: {
    sum: bigint;
    sec: bigint;
    window: bigint;
    readonly wallets: Map<AccountId, bigint>;
  };
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
  | 'unknown-order'
  | 'would-trigger'
  | 'house-one-sided'
  | 'house-inventory'
  | 'house-loss-limit'
  | 'would-take'
  | 'invalid-order';

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

/** When a conditional order fires: the mark rising to/above or falling to/below its price. */
export interface StopTrigger {
  readonly price: bigint;
  readonly triggersOn: 'rise' | 'fall';
}

/**
 * A resting order (GTC, full fills only, against the house quote): a limit order, or a
 * conditional (stop / take-profit) order waiting for its mark trigger.
 */
export interface RestingOrder {
  readonly orderId: string;
  readonly requestId: string;
  readonly account: AccountId;
  readonly market: MarketId;
  /** Signed lots: + buy, − sell. */
  readonly qty: bigint;
  /** null = market once triggered (stop-market). Plain resting orders always have one. */
  readonly limitPrice: bigint | null;
  readonly reduceOnly: boolean;
  /** null = no trigger pending (a plain limit, or a stop-limit that has fired). */
  readonly stop: StopTrigger | null;
  readonly ocoGroup: string | null;
}

/** An on-chain withdrawal reserved by the engine (M4-18): user → vault-pending until settled. */
export interface Withdrawal {
  /** `${account}:${requestId}`. */
  readonly id: string;
  readonly account: AccountId;
  readonly amount: Usdc;
  /** EIP-712 nonce for the Vault (M5-04), unique per withdrawal. */
  readonly nonce: bigint;
  /** Event-time ms after which the authorisation is void on-chain. */
  readonly deadline: bigint;
  readonly status: 'pending' | 'executed' | 'expired';
}

export interface EngineState {
  seq: bigint;
  ts: bigint;
  genesis: boolean;
  /** Genesis amounts, the reference for CB7 (ADR-0013); null before genesis. */
  genesisCapital: { readonly house: bigint; readonly insurance: bigint } | null;
  /** CB7 active: global reduce-only (no new exposure in any market). */
  capitalFloor: boolean;
  /** Daily house loss limit (M4-14): reference equity of the current UTC day, and the halt. */
  readonly houseRisk: {
    dailyLossLimit: bigint | null;
    day: bigint;
    dayStartEquity: bigint;
    halted: boolean;
  };
  /** Genesis + deposits − executed withdrawals, tracked independently of the ledger (Invariant 1). */
  netDeposits: bigint;
  readonly markets: Map<MarketId, MarketState>;
  readonly accounts: Map<AccountId, AccountState>;
  readonly ledger: Ledger;
  /** `${account}:${idempotencyKey}` → first outcome (replayed for duplicates). */
  readonly idempotency: Map<string, OrderOutcome>;
  /** `${account}:${orderId}` → resting limit order, matched in insertion (time) order. */
  readonly orders: Map<string, RestingOrder>;
  /** Withdrawals by id, in request order (M4-18). */
  readonly withdrawals: Map<string, Withdrawal>;
  /** Next withdrawal nonce. */
  withdrawalNonce: bigint;
}

export function createState(): EngineState {
  return {
    seq: 0n,
    ts: 0n,
    genesis: false,
    genesisCapital: null,
    capitalFloor: false,
    houseRisk: { dailyLossLimit: null, day: 0n, dayStartEquity: 0n, halted: false },
    netDeposits: 0n,
    markets: new Map(),
    accounts: new Map(),
    ledger: new Ledger(),
    idempotency: new Map(),
    orders: new Map(),
    withdrawals: new Map(),
    withdrawalNonce: 0n,
  };
}
