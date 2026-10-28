import { lots, ticks, usdc } from '@euroedge/fixed';
import { apply } from '../src/core/apply.ts';
import type { EngineInput, WindowId, WindowRisk } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { createState, type EngineState } from '../src/core/state.ts';

/** Quote-model terms switched off: the M1 quote FV ± h (tests opt in per case). */
export const M1_QUOTE = {
  sigmaSpreadBps: 0n,
  inventorySkewBps: 0n,
  inventoryCap: null,
  impactBps: 0n,
  impactRef: usdc(1n),
  impactAlphaHalves: 3n,
  inventoryHardCap: null,
  oiCap: null,
} as const;

/** windows.yaml values as engine params. */
export const WINDOWS: Record<WindowId, WindowRisk> = {
  A: {
    ...M1_QUOTE,
    maxLeverage: 5n,
    takerFeeBps: 5n,
    makerFeeBps: 1n,
    houseHalfSpreadBps: 5n,
    priceLimitBps: 1000n,
    fundingCapPpmPerHour: 300n,
    fundingOiCap: usdc(2_000_000_000_000n),
  },
  B: {
    ...M1_QUOTE,
    maxLeverage: 4n,
    takerFeeBps: 8n,
    makerFeeBps: 2n,
    houseHalfSpreadBps: 10n,
    priceLimitBps: 500n,
    fundingCapPpmPerHour: 200n,
    fundingOiCap: usdc(1_000_000_000_000n),
  },
  C: {
    ...M1_QUOTE,
    maxLeverage: 3n,
    takerFeeBps: 12n,
    makerFeeBps: 3n,
    houseHalfSpreadBps: 20n,
    priceLimitBps: 400n,
    fundingCapPpmPerHour: 100n,
    fundingOiCap: usdc(500_000_000_000n),
  },
  D: {
    ...M1_QUOTE,
    maxLeverage: 2n,
    takerFeeBps: 20n,
    makerFeeBps: 5n,
    houseHalfSpreadBps: 35n,
    priceLimitBps: 300n,
    fundingCapPpmPerHour: null,
    fundingOiCap: usdc(0n),
  },
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
  flow: { kappaPpmPerMUsdc: 0n, tauSec: 300n, walletCap: usdc(0n), walletWindowSec: 60n },
  fundingInterestBpsPerYear: 500n,
  partialLiquidationBufferBps: 2500n,
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
  /** Extra event time added by `skip` (ms). */
  private offset = 0n;

  /** Moves event time forward by `ms` for all later inputs. */
  skip(ms: bigint): this {
    this.offset += ms;
    return this;
  }

  run(...inputs: EngineInput[]): EngineOutput[] {
    return inputs.flatMap((input) => {
      this.log.push(input);
      return apply(this.state, {
        seq: this.state.seq + 1n,
        ts: 1_793_000_000_000n + this.state.seq * 1000n + this.offset,
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
