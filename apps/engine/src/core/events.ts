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
  /** Quote model (ADR-0003; values proposed in ADR-0019). a: σ_FV share added to h. */
  readonly sigmaSpreadBps: bigint;
  /** s: inventory skew at full inventoryCap. */
  readonly inventorySkewBps: bigint;
  /** House inventory (µUSDC at FV) of full skew; null = no skew. */
  readonly inventoryCap: Usdc | null;
  /** γ: marginal impact at impactRef. */
  readonly impactBps: bigint;
  /** x_ref, µUSDC. */
  readonly impactRef: Usdc;
  /** α in halves: 3 = 1.5, 4 = 2. */
  readonly impactAlphaHalves: bigint;
  /** House inventory (µUSDC at FV) past which the market is reduce-only; null = none (M4-14). */
  readonly inventoryHardCap: Usdc | null;
  /** Gross user OI cap at mark, µUSDC (M4-08); null = none. */
  readonly oiCap: Usdc | null;
}

export interface FlowParams {
  /** κ: shift in ppm per 1 000 000 USDC of decayed net flow; 0 = no shift. */
  readonly kappaPpmPerMUsdc: bigint;
  /** τ: net flow decays by (1 − 1/τ) per second. */
  readonly tauSec: bigint;
  /** Max |notional| one wallet adds per window, µUSDC. */
  readonly walletCap: Usdc;
  readonly walletWindowSec: bigint;
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
      /** Flow shift (ADR-0003 step 4; values proposed in ADR-0019). */
      readonly flow: FlowParams;
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
      /**
       * Limit orders (M4-05/06): `gtc` rests (default); `ioc` / `fok` fill at once or are
       * rejected, never rest. With full fills only, FOK and IOC behave the same.
       */
      readonly timeInForce?: 'gtc' | 'ioc' | 'fok';
      /** Limit orders: rejected instead of taking if marketable at placement (maker only). */
      readonly postOnly?: boolean;
    }
  | {
      readonly type: 'CancelOrder';
      readonly requestId: string;
      readonly account: AccountId;
      /** The idempotency key the order was placed with. */
      readonly orderId: string;
    }
  | {
      /** Global house risk parameters (M4-14, ADR-0019), from windows.yaml at startup. */
      readonly type: 'HouseRiskParams';
      /** Max house loss (µUSDC) per UTC day before global reduce-only; null = none. */
      readonly dailyLossLimit: Usdc | null;
    }
  | {
      /**
       * A dividend goes ex (M4-16), at the local ex-date of the primary line. Longs receive
       * it net of withholding, shorts pay it gross; the house takes the other side.
       */
      readonly type: 'DividendExDate';
      readonly market: MarketId;
      /** ISO date; with the market, the idempotency key. */
      readonly exDate: string;
      /** Gross dividend per share, in price ticks. */
      readonly grossPerShare: Ticks;
      /** Withholding on what longs receive, bps (config per market; proposal 1 500). */
      readonly withholdingBps: bigint;
    }
  | {
      /**
       * Earnings leverage step (M4-08): from `startTs` to `endTs` (event-time ms) new exposure
       * and initial margin in the market use at most `maxLeverage`. Same id replaces.
       */
      readonly type: 'EarningsWindow';
      readonly market: MarketId;
      readonly id: string;
      readonly startTs: bigint;
      readonly endTs: bigint;
      readonly maxLeverage: bigint;
    }
  | {
      /** Admin (M4-17): freeze a market for a corporate action; resting orders are cancelled. */
      readonly type: 'CorporateActionFreeze';
      readonly market: MarketId;
      readonly actionId: string;
    }
  | {
      /** Admin: apply a split num:den (one old share becomes num/den new shares). */
      readonly type: 'CorporateActionAdjust';
      readonly market: MarketId;
      readonly actionId: string;
      readonly ratioNum: bigint;
      readonly ratioDen: bigint;
    }
  | {
      /** Admin: resume trading after the corporate action. */
      readonly type: 'CorporateActionUnfreeze';
      readonly market: MarketId;
      readonly actionId: string;
    }
  | {
      /** Indexer (M5-09): a Vault `Deposited` log at the safe tag. Credited once per log. */
      readonly type: 'ChainDeposit';
      readonly account: AccountId;
      readonly amount: Usdc;
      readonly txHash: string;
      readonly logIndex: number;
    }
  | {
      /** Indexer (M5-09): a Vault `Withdrawn` log; settles the pending withdrawal with this nonce. */
      readonly type: 'VaultWithdrawn';
      readonly account: AccountId;
      readonly amount: Usdc;
      readonly nonce: bigint;
      readonly txHash: string;
      readonly logIndex: number;
    }
  | {
      /** Reserve collateral for an on-chain withdrawal to the account's address (M4-18). */
      readonly type: 'RequestWithdrawal';
      readonly requestId: string;
      readonly account: AccountId;
      readonly amount: Usdc;
    }
  | {
      /** Indexer: the Vault paid the withdrawal out (safe tag). */
      readonly type: 'WithdrawalExecuted';
      readonly withdrawalId: string;
    }
  | {
      /** Indexer: the deadline passed with the nonce unused; the amount is re-credited. */
      readonly type: 'WithdrawalExpired';
      readonly withdrawalId: string;
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
