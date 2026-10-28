import { lots, ticks, usdc } from '@euroedge/fixed';
import { apply } from '../src/core/apply.ts';
import type { EngineEvent, EngineInput, WindowId, WindowRisk } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { createState, type EngineState } from '../src/core/state.ts';

/** windows.yaml values as engine params. */
const w = (
  maxLeverage: bigint,
  takerFeeBps: bigint,
  makerFeeBps: bigint,
  houseHalfSpreadBps: bigint,
  priceLimitBps: bigint,
  fundingCapPpmPerHour: bigint | null,
  oiCapUsdc: bigint | null,
): WindowRisk => ({
  maxLeverage,
  takerFeeBps,
  makerFeeBps,
  houseHalfSpreadBps,
  priceLimitBps,
  fundingCapPpmPerHour,
  fundingOiCap: oiCapUsdc === null ? null : usdc(oiCapUsdc * 1_000_000n),
});

/** windows.yaml values as engine params. */
export const WINDOWS: Record<WindowId, WindowRisk> = {
  A: w(5n, 5n, 1n, 5n, 1000n, 300n, 2_000_000n),
  B: w(4n, 8n, 2n, 10n, 500n, 200n, 1_000_000n),
  C: w(3n, 12n, 3n, 20n, 400n, 100n, 500_000n),
  D: w(2n, 20n, 5n, 35n, 300n, null, null),
};

export const USDC = 1_000_000n;

export const listASML: EngineInput = {
  type: 'MarketListed',
  market: 'ASML-PERP',
  kind: 'stock',
  tickSize: '0.01',
  lotSize: '0.01',
  minNotional: usdc(10n * USDC),
  maintenanceMarginBps: 1000n,
  liquidationPenaltyBps: 100n,
  fundingInterestBpsPerYear: 500n,
  windows: WINDOWS,
};

/** Market data with a symmetric band of ±`halfBand` ticks around `px`. */
export function data(
  px: bigint,
  window: WindowId = 'A',
  halfBand = 500n,
  mark = px,
  index = px,
): EngineInput {
  return {
    type: 'MarketData',
    market: 'ASML-PERP',
    window,
    fv: ticks(px),
    bandLo: ticks(px - halfBand),
    bandHi: ticks(px + halfBand),
    index: ticks(index),
    mark: ticks(mark),
    markClamped: false,
    sigmaPpm: 500n,
    breaker: 'none',
  };
}

let n = 0;
export const order = (
  account: string,
  side: 'buy' | 'sell',
  qtyLots: bigint,
  opts: { key?: string; reduceOnly?: boolean } = {},
): EngineInput => {
  n += 1;
  return {
    type: 'PlaceOrder',
    requestId: `r${n}`,
    idempotencyKey: opts.key ?? `k${n}`,
    account,
    market: 'ASML-PERP',
    side,
    qty: lots(qtyLots),
    reduceOnly: opts.reduceOnly ?? false,
  };
};

/** Small harness: applies inputs with consecutive seqs and 1 s spacing. */
export class Harness {
  readonly state: EngineState = createState();
  readonly log: EngineEvent[] = [];
  /** Event time of the next input (UTC ms); each input advances it by 1 s. */
  now = 1_793_000_000_000n;

  run(...inputs: EngineInput[]): EngineOutput[] {
    return inputs.flatMap((input) => {
      const e: EngineEvent = { seq: this.state.seq + 1n, ts: this.now, v: 1, input };
      this.log.push(e);
      this.now += 1000n;
      return apply(this.state, e);
    });
  }

  /** Moves event time to `ts` (never backwards). */
  at(ts: bigint): this {
    if (ts < this.now) throw new Error('time goes forward only');
    this.now = ts;
    return this;
  }

  static booted(): Harness {
    const h = new Harness();
    h.run(
      {
        type: 'GenesisCapital',
        house: usdc(50_000_000n * USDC),
        insurance: usdc(5_000_000n * USDC),
        source: 'dev',
      },
      listASML,
      data(70_000n),
      { type: 'DevDeposit', account: 'alice', amount: usdc(10_000n * USDC) },
    );
    return h;
  }
}
