import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import type { EngineInput, WindowRisk } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { decodeEvent } from '../src/log/codec.ts';
import { marketSnapshot } from '../src/snapshots.ts';
import { data, Harness, listASML, order, USDC, WINDOWS } from './fixtures.ts';

/** Window A with the proposed quote terms: a = 25 % of σ, s = 5 bp at 2 M, γ = 5 bp at 100 k, α 1.5. */
const A: WindowRisk = {
  ...WINDOWS.A,
  sigmaSpreadBps: 2_500n,
  inventorySkewBps: 5n,
  inventoryCap: usdc(2_000_000n * USDC),
  impactBps: 5n,
  impactRef: usdc(100_000n * USDC),
  impactAlphaHalves: 3n,
};

function harness(): Harness {
  const h = Harness.booted();
  h.run({ ...listASML, windows: { ...WINDOWS, A } } as EngineInput, {
    type: 'DevDeposit',
    account: 'bob',
    amount: usdc(10_000n * USDC),
  });
  return h;
}

const price = (out: EngineOutput[]) => {
  const f = out.find((o) => o.type === 'OrderFilled');
  return f?.type === 'OrderFilled' ? f.fill.price : undefined;
};

describe('house quote model in the engine (M4-02)', () => {
  it('prices σ widening and convex size impact into every fill', () => {
    // σ 500 ppm × 25 % = 125 → h = 625 ppm. 1 share (≈ 700 USDC): impact ⌈0.12⌉ = 1 ppm.
    expect(price(harness().run(order('alice', 'buy', 100n)))).toBe(70_044n); // ⌈70 043.82⌉
    // 70 shares (49 000 USDC): (0.49)^1.5 × 200 = 68.6 → 69 ppm → h 694 → ⌈70 048.58⌉.
    expect(price(harness().run(order('alice', 'buy', 7_000n)))).toBe(70_049n);
  });

  it('skews with house inventory: after users sell, buying gets cheaper', () => {
    const h = harness();
    // Bob sells 70 shares at ⌊70 000 × (1 − 694 ppm)⌋ = 69 951; the house is long 49 000 USDC.
    expect(price(h.run(order('bob', 'sell', 7_000n)))).toBe(69_951n);
    // Skew on the ask: −500 ppm × 49 000 / 2 000 000 = −12.25 → ⌈⌉ −12; h = 625 − 12 + 1 = 614.
    expect(price(h.run(order('alice', 'buy', 100n)))).toBe(70_043n); // ⌈70 042.98⌉
  });

  it('publishes a ladder from the same function, widening with size', () => {
    const h = harness();
    const snap = marketSnapshot(h.state, 'ASML-PERP');
    expect(snap?.ladder.map((r) => r.notional)).toEqual([
      '1000.000000',
      '5000.000000',
      '25000.000000',
      '100000.000000',
    ]);
    const asks = snap?.ladder.map((r) => Number(r.ask)) ?? [];
    expect([...asks].sort((a, b) => a - b)).toEqual(asks);
    expect(snap?.ask).toBe('700.44'); // zero size: h = 625 ppm → ⌈70 043.75⌉
    expect(snap?.ladder.at(-1)?.ask).toBe('700.58'); // 100 k: + 200 ppm → ⌈70 057.75⌉
  });

  it('a degraded market doubles h in the published quote too', () => {
    const h = harness();
    h.run({ ...data(70_000n), breaker: 'degraded' } as EngineInput);
    expect(marketSnapshot(h.state, 'ASML-PERP')?.ask).toBe('700.88'); // ⌈70 087.5⌉
  });

  it('MarketListed v2 logs (no quote terms) decode to the M1 quote', () => {
    const risk = {
      maxLeverage: '5',
      takerFeeBps: '5',
      makerFeeBps: '1',
      houseHalfSpreadBps: '5',
      priceLimitBps: '1000',
      fundingCapPpmPerHour: '300',
      fundingOiCap: '1',
    };
    const e = decodeEvent(
      JSON.stringify({
        seq: '1',
        ts: '1',
        v: 2,
        input: {
          type: 'MarketListed',
          market: 'ASML-PERP',
          kind: 'stock',
          tickSize: '0.01',
          lotSize: '0.01',
          minNotional: '10000000',
          maintenanceMarginBps: '1000',
          liquidationPenaltyBps: '100',
          windows: { A: risk, B: risk, C: risk, D: risk },
        },
      }),
    );
    expect(e.input).toMatchObject({
      windows: {
        A: {
          sigmaSpreadBps: 0n,
          inventorySkewBps: 0n,
          inventoryCap: null,
          impactBps: 0n,
          impactRef: 1n,
          impactAlphaHalves: 3n,
        },
      },
    });
  });
});
