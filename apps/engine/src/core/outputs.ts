import type { Ticks, Usdc } from '@euroedge/fixed';
import type { AccountId, MarketId } from './events.ts';
import type { Fill, RejectReason } from './state.ts';

/** Engine OUTPUTS: derived from inputs, recomputed on replay, never logged (ADR-0001). */
export type EngineOutput =
  | {
      readonly type: 'OrderFilled';
      readonly requestId: string;
      readonly account: AccountId;
      readonly fill: Fill;
      readonly duplicate: boolean;
    }
  | {
      readonly type: 'OrderRejected';
      readonly requestId: string;
      readonly account: AccountId;
      readonly reason: RejectReason;
      readonly duplicate: boolean;
    }
  | {
      readonly type: 'Liquidated';
      readonly account: AccountId;
      readonly markets: readonly MarketId[];
      readonly penalty: Usdc;
      /** Shortfall covered by the insurance fund (negative-balance protection). */
      readonly insuranceCover: Usdc;
    }
  | {
      /** Hourly funding settlement of one market (ADR-0016, ADR-0018). */
      readonly type: 'FundingSettled';
      readonly market: MarketId;
      /** The UTC hour boundary settled. */
      readonly hourTs: bigint;
      /** Rate in force after settlement, Rate (1e-18) per hour; > 0 longs pay. */
      readonly ratePerHour: bigint;
      readonly paid: Usdc;
      readonly received: Usdc;
      /** Rounding residue to fees (≥ 0). */
      readonly residue: Usdc;
      /** Payments beyond a payer's equity, covered by insurance. */
      readonly insuranceCover: Usdc;
    }
  | {
      /** ADR-0009: the band decided the mark. */
      readonly type: 'MarkClamped';
      readonly market: MarketId;
      readonly mark: Ticks;
      readonly bandLo: Ticks;
      readonly bandHi: Ticks;
    }
  | { readonly type: 'InputIgnored'; readonly input: string; readonly reason: string }
  | { readonly type: 'AccountChanged'; readonly account: AccountId }
  | { readonly type: 'MarketChanged'; readonly market: MarketId };
