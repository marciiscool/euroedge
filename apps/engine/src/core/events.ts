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
  /** Fee for resting limit orders filled later (M4). */
  readonly makerFeeBps: bigint;
  readonly houseHalfSpreadBps: bigint;
  readonly priceLimitBps: bigint;
  /** Hourly cap on the total funding rate, ppm; null = interest only (Window D). */
  readonly fundingCapPpmPerHour: bigint | null;
  /** Net user OI skew (µUSDC) at which the skew term reaches the cap. */
  readonly fundingOiCap: Usdc;
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
      /** Partial liquidation target buffer over MM, bps; null = full liquidation only (v1 logs). */
      readonly partialLiquidationBufferBps: bigint | null;
      /** Funding interest component, longs pay shorts (ADR-0016). */
      readonly fundingInterestBpsPerYear: bigint;
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
      /** Limit price (ticks); absent = market order. Unfilled limits rest (GTC, full fills only). */
      readonly limitPrice?: Ticks;
      /**
       * Conditional order (M4-07), triggered on the mark: a stop fires when the mark moves
       * against the order's side (buy: mark ≥ price, sell: mark ≤ price), a take-profit when
       * it moves the other way. Without `limitPrice` it executes as a market order.
       */
      readonly stop?: { readonly price: Ticks; readonly kind: 'stop' | 'take-profit' };
      /** Orders of one account sharing a group are one-cancels-other (TP/SL). */
      readonly ocoGroup?: string;
    }
  | {
      readonly type: 'CancelOrder';
      readonly requestId: string;
      readonly account: AccountId;
      /** The idempotency key the order was placed with. */
      readonly orderId: string;
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
