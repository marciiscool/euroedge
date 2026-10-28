import { describe, expect, it } from 'vitest';
import { ticks, usdc } from '@euroedge/fixed';
import type { EngineInput, WindowRisk } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { marketSnapshot } from '../src/snapshots.ts';
import { data, Harness, listASML, order, USDC, WINDOWS } from './fixtures.ts';

function harness(a: Partial<WindowRisk>): Harness {
  const h = Harness.booted();
  h.run({ ...listASML, windows: { ...WINDOWS, A: { ...WINDOWS.A, ...a } } } as EngineInput);
  for (const acc of ['alice', 'bob'])
    h.run({ type: 'DevDeposit', account: acc, amount: usdc(1_000_000n * USDC) });
  return h;
}

const reason = (out: EngineOutput[]) => {
  const r = out.find((o) => o.type === 'OrderRejected');
  return r?.type === 'OrderRejected' ? r.reason : undefined;
};
const filled = (out: EngineOutput[]) => out.some((o) => o.type === 'OrderFilled');
const limit = (h: Harness) => marketSnapshot(h.state, 'ASML-PERP')?.inventoryLimit;

describe('house inventory limits (M4-14, ADR-0003 §7)', () => {
  const caps = { inventoryCap: usdc(100_000n * USDC), inventoryHardCap: usdc(200_000n * USDC) };

  it('past invCap the house quotes one side only', () => {
    const h = harness(caps);
    // Bob sells 150 shares: the house is long 150 × 700 = 105 000 USDC ≥ 100 000.
    expect(filled(h.run(order('bob', 'sell', 15_000n)))).toBe(true);
    expect(limit(h)).toBe('no-sells');
    expect(reason(h.run(order('alice', 'sell', 100n)))).toBe('house-one-sided');
    // Buying takes inventory off the house; reducing one's own position always works.
    expect(filled(h.run(order('alice', 'buy', 100n)))).toBe(true);
    expect(filled(h.run(order('bob', 'buy', 100n, { reduceOnly: true })))).toBe(true);
  });

  it('no order may take the house past invHardCap, and past it the market is reduce-only', () => {
    const h = harness({ inventoryCap: null, inventoryHardCap: caps.inventoryHardCap });
    // 300 shares would leave the house long 210 000 > 200 000.
    expect(reason(h.run(order('bob', 'sell', 30_000n)))).toBe('house-inventory');
    expect(filled(h.run(order('bob', 'sell', 25_000n)))).toBe(true); // 175 000
    // FV +20 %: the same inventory is now worth 210 000 at FV.
    h.run(data(84_000n));
    expect(limit(h)).toBe('reduce-only');
    expect(reason(h.run(order('alice', 'buy', 100n)))).toBe('house-inventory');
    expect(filled(h.run(order('bob', 'buy', 5_000n, { reduceOnly: true })))).toBe(true);
    expect(limit(h)).toBe('none');
  });

  it('a resting order waits while the house is one-sided and fills once it is not', () => {
    const h = harness(caps);
    const rest = {
      ...(order('alice', 'sell', 100n, { key: 'S' }) as Extract<
        EngineInput,
        { type: 'PlaceOrder' }
      >),
      limitPrice: ticks(70_100n),
    };
    expect(h.run(rest).some((o) => o.type === 'OrderAccepted')).toBe(true);
    h.run(order('bob', 'sell', 15_000n)); // house long 105 000: one-sided
    // bid ⌊70 200 × 0.9995⌋ = 701.64 crosses 701.00, but the house refuses more user selling.
    expect(h.run(data(70_200n)).some((o) => o.type === 'OrderCancelled')).toBe(false);
    expect(h.state.orders.has('alice:S')).toBe(true);
    h.run(order('bob', 'buy', 15_000n, { reduceOnly: true })); // house flat again
    expect(filled(h.run(data(70_200n)))).toBe(true);
  });
});

describe('daily house loss limit (M4-14)', () => {
  /** First UTC midnight after the harness start (1 793 000 000 000). */
  const MIDNIGHT = 1_793_059_200_000n;

  it('halts new exposure everywhere once today’s loss exceeds the limit, until the next UTC day', () => {
    const h = harness({});
    h.run({ type: 'HouseRiskParams', dailyLossLimit: usdc(1_000n * USDC) });
    h.run(order('alice', 'buy', 10_000n)); // 100 shares at 700.35: house short
    // FV +2 %: the house loses about 100 × 13.65 = 1 365 USDC > 1 000.
    const trip = h.run(data(71_400n));
    expect(trip.find((o) => o.type === 'HouseLossLimitChanged')).toMatchObject({ active: true });
    expect(marketSnapshot(h.state, 'ASML-PERP')?.houseLossLimit).toBe(true);
    expect(reason(h.run(order('bob', 'buy', 100n)))).toBe('house-loss-limit');
    expect(filled(h.run(order('alice', 'sell', 1_000n, { reduceOnly: true })))).toBe(true);

    // The first input of the next UTC day releases it and sets a new reference.
    const ts = 1_793_000_000_000n + h.state.seq * 1000n;
    const next = h.skip(MIDNIGHT - ts).run({ type: 'ClockTick' });
    expect(next.find((o) => o.type === 'HouseLossLimitChanged')).toMatchObject({ active: false });
    expect(filled(h.run(order('bob', 'buy', 100n)))).toBe(true);
  });

  it('is off without a limit', () => {
    const h = harness({});
    h.run(order('alice', 'buy', 10_000n), data(71_400n));
    expect(h.state.houseRisk.halted).toBe(false);
  });
});
