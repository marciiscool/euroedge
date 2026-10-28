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
      /** ADR-0009: the band decided the mark. */
      readonly type: 'MarkClamped';
      readonly market: MarketId;
      readonly mark: Ticks;
      readonly bandLo: Ticks;
      readonly bandHi: Ticks;
    }
  | { readonly type: 'InputIgnored'; readonly input: string; readonly reason: string }
  | { readonly type: 'AccountChanged'; readonly account: AccountId }
  | { readonly type: 'MarketChanged'; readonly market: MarketId }
  | {
      readonly type: 'OrderAccepted';
      readonly requestId: string;
      readonly account: AccountId;
      readonly orderId: string;
      readonly duplicate: boolean;
    }
  | {
      /** A resting order left the book: cancelled by the user, or failed its checks at trigger. */
      readonly type: 'OrderCancelled';
      readonly requestId: string;
      readonly account: AccountId;
      readonly orderId: string;
      readonly reason: RejectReason | 'user';
    }
  | {
      /** Hourly funding settled: positive rate = longs paid shorts (Rate, 1e18 per hour). */
      readonly type: 'FundingSettled';
      readonly market: MarketId;
      readonly hour: bigint;
      readonly rate: bigint;
    };
