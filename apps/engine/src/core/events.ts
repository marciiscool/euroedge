import type { Lots, Ticks, Usdc } from '@euroedge/fixed';

/**
 * Engine INPUT events (ADR-0001). Only inputs are logged; outputs (fills, postings,
 * rejections) are recomputed on replay. All numbers are integers (bigint for money,
 * prices, quantities and time).
 */

export type AccountId = string;
export type MarketId = string;
export type WindowId = 'A' | 'B' | 'C' | 'D';
export type Side = 'buy' | 'sell';
export type BreakerEffect = 'none' | 'no-opens' | 'degraded' | 'reduce-only';

export interface WindowRisk {
  /** Max leverage on new exposure; 0 = reduce-only. */
  readonly maxLeverage: bigint;
  readonly takerFeeBps: bigint;
  readonly houseHalfSpreadBps: bigint;
  readonly priceLimitBps: bigint;
}

export type EngineInput =
  | { readonly type: 'ClockTick' }
  | {
      /** House and insurance capital (ADR-0013). Must precede any other credit. */
      readonly type: 'GenesisCapital';
      readonly house: Usdc;
      readonly insurance: Usdc;
      /** 'dev' in sim (M1); 'chain' once the Vault exists (M5). */
      readonly source: 'dev' | 'chain';
    }
  | {
      readonly type: 'MarketListed';
      readonly market: MarketId;
      readonly kind: 'stock' | 'basket';
      readonly tickSize: string;
      readonly lotSize: string;
      readonly minNotional: Usdc;
      readonly maintenanceMarginBps: bigint;
      readonly liquidationPenaltyBps: bigint;
      readonly windows: Readonly<Record<WindowId, WindowRisk>>;
    }
  | {
      /** Quantized output of fv-service (brief §6). */
      readonly type: 'MarketData';
      readonly market: MarketId;
      readonly window: WindowId;
      readonly fv: Ticks;
      readonly bandLo: Ticks;
      readonly bandHi: Ticks;
      readonly index: Ticks;
      readonly mark: Ticks;
      /** ADR-0009: the band, not the step cap, decided the mark (the MarkClamped record). */
      readonly markClamped: boolean;
      readonly sigmaPpm: bigint;
      /** Combined circuit-breaker effect from fv-service (brief §6.5). v1 logs decode as 'none'. */
      readonly breaker: BreakerEffect;
    }
  | {
      /** Play-money credit without a chain (sim tier, dev login only). */
      readonly type: 'DevDeposit';
      readonly account: AccountId;
      readonly amount: Usdc;
    }
  | {
      readonly type: 'PlaceOrder';
      readonly requestId: string;
      readonly idempotencyKey: string;
      readonly account: AccountId;
      readonly market: MarketId;
      readonly side: Side;
      readonly qty: Lots;
      readonly reduceOnly: boolean;
    }
  | {
      readonly type: 'ClosePosition';
      readonly requestId: string;
      readonly idempotencyKey: string;
      readonly account: AccountId;
      readonly market: MarketId;
    };

export type EngineInputType = EngineInput['type'];

/** A logged input with its sequence number and sequencer timestamp. */
export interface EngineEvent {
  readonly seq: bigint;
  /** UTC ms stamped by the sequencer — the only clock the core ever sees. */
  readonly ts: bigint;
  /** Schema version of this event type. */
  readonly v: number;
  readonly input: EngineInput;
}
