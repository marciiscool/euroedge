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

/**
 * Exact funding owed by one holder since its last settlement, in index units (µUSDC·Rate·ms):
 * `pending + lots × (index − snap)`. Rolled forward before every change of its lots.
 */
export interface FundingAccrual {
  readonly snap: bigint;
  readonly pending: bigint;
}

export interface MarketFunding {
  /** Cumulative funding per lot, µUSDC·Rate·ms (risk-core FUNDING_INDEX_SCALE). */
  index: bigint;
  /** Event time the index was last advanced to. */
  lastTs: bigint;
  /** Stored, 0 in v1 (ADR-0016). */
  readonly quantoDrift: bigint;
  house: FundingAccrual;
}

export interface MarketState {
  readonly id: MarketId;
  readonly kind: 'stock' | 'basket';
  readonly units: MarketUnits;
  readonly minNotional: Usdc;
  readonly maintenanceMarginBps: bigint;
  readonly liquidationPenaltyBps: bigint;
  readonly fundingInterestBpsPerYear: bigint;
  readonly windows: Readonly<Record<WindowId, WindowRisk>>;
  data: MarketData | undefined;
  readonly funding: MarketFunding;
  /** House position = exact negative of all user positions (lots and cost). */
  house: Position;
}

export interface AccountState {
  readonly id: AccountId;
  readonly positions: Map<MarketId, Position>;
  /** Unsettled funding per market; present while the holder has accrued since settlement. */
  readonly funding: Map<MarketId, FundingAccrual>;
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
  | 'circuit-breaker';

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
  | { readonly status: 'rejected'; readonly reason: RejectReason };

export interface EngineState {
  seq: bigint;
  ts: bigint;
  genesis: boolean;
  /** Genesis + deposits − executed withdrawals, tracked independently of the ledger (Invariant 1). */
  netDeposits: bigint;
  /** Next hourly funding settlement (UTC ms); 0 until the first event. */
  fundingNextTs: bigint;
  readonly markets: Map<MarketId, MarketState>;
  readonly accounts: Map<AccountId, AccountState>;
  readonly ledger: Ledger;
  /** `${account}:${idempotencyKey}` → first outcome (replayed for duplicates). */
  readonly idempotency: Map<string, OrderOutcome>;
}

export function createState(): EngineState {
  return {
    seq: 0n,
    ts: 0n,
    genesis: false,
    netDeposits: 0n,
    fundingNextTs: 0n,
    markets: new Map(),
    accounts: new Map(),
    ledger: new Ledger(),
    idempotency: new Map(),
  };
}
