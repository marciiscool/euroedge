import { lots, ticks, usdc } from '@euroedge/fixed';
import { apply } from '../src/core/apply.ts';
import type { EngineInput, WindowId, WindowRisk } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { createState, type EngineState } from '../src/core/state.ts';

/** windows.yaml values as engine params. */
export const WINDOWS: Record<WindowId, WindowRisk> = {
  A: { maxLeverage: 5n, takerFeeBps: 5n, houseHalfSpreadBps: 5n, priceLimitBps: 1000n },
  B: { maxLeverage: 4n, takerFeeBps: 8n, houseHalfSpreadBps: 10n, priceLimitBps: 500n },
  C: { maxLeverage: 3n, takerFeeBps: 12n, houseHalfSpreadBps: 20n, priceLimitBps: 400n },
  D: { maxLeverage: 2n, takerFeeBps: 20n, houseHalfSpreadBps: 35n, priceLimitBps: 300n },
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
  readonly log: EngineInput[] = [];

  run(...inputs: EngineInput[]): EngineOutput[] {
    return inputs.flatMap((input) => {
      this.log.push(input);
      return apply(this.state, {
        seq: this.state.seq + 1n,
        ts: 1_793_000_000_000n + this.state.seq * 1000n,
        v: 1,
        input,
      });
    });
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
