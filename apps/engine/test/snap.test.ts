import { describe, expect, it } from 'vitest';
import type { EngineOutput } from '../src/core/outputs.ts';
import { SNAP_REDUCE_ONLY_MS } from '../src/core/snap.ts';
import { data, Harness, order } from './fixtures.ts';

const reason = (out: EngineOutput[]) => {
  const r = out.find((o) => o.type === 'OrderRejected');
  return r?.type === 'OrderRejected' ? r.reason : undefined;
};
const liquidated = (out: EngineOutput[]) => out.some((o) => o.type === 'Liquidated');
const lots = (h: Harness) => h.state.accounts.get('alice')?.positions.get('ASML-PERP')?.lots ?? 0n;

describe('snap period (M4-13)', () => {
  it('a snap outside the last band makes the market reduce-only for 5 minutes', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 100n), data(70_000n, 'B'));
    h.run(data(73_000n, 'A')); // band was 695–705: the open lands outside
    expect(reason(h.run(order('alice', 'buy', 100n)))).toBe('snap-outside-band');
    expect(
      h
        .run(order('alice', 'sell', 100n, { reduceOnly: true }))
        .some((o) => o.type === 'OrderFilled'),
    ).toBe(true);
    h.skip(SNAP_REDUCE_ONLY_MS).run(data(73_000n, 'A'));
    expect(h.run(order('alice', 'buy', 100n)).some((o) => o.type === 'OrderFilled')).toBe(true);
  });

  it('a snap inside the band changes nothing', () => {
    const h = Harness.booted();
    h.run(data(70_000n, 'B'), data(70_300n, 'A'));
    expect(h.run(order('alice', 'buy', 100n)).some((o) => o.type === 'OrderFilled')).toBe(true);
  });

  it('the snap print alone does not liquidate; the mean of later prints decides', () => {
    // alice: 70 shares ≈ 5× on 10 000 USDC; below maintenance under ≈ 619.8.
    const h = Harness.booted();
    h.run(order('alice', 'buy', 7_000n), data(70_000n, 'B'));
    expect(liquidated(h.run(data(61_000n, 'A')))).toBe(false); // the opening print
    expect(lots(h)).toBe(7_000n);
    // The price recovers: mean (610 + 690) / 2 = 650 > 619.8, so alice is safe.
    expect(liquidated(h.run(data(69_000n, 'A')))).toBe(false);
    expect(lots(h)).toBe(7_000n);
  });

  it('…but a mean that stays low liquidates, and insolvency at spot always does', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 7_000n), data(70_000n, 'B'));
    h.run(data(61_000n, 'A'));
    expect(liquidated(h.run(data(61_000n, 'A')))).toBe(true); // mean 610 < 619.8

    const g = Harness.booted();
    g.run(order('alice', 'buy', 7_000n), data(70_000n, 'B'));
    // −25 %: equity ≈ 9 951 − 70 × 175 < 0 at spot.
    expect(liquidated(g.run(data(52_500n, 'A')))).toBe(true);
  });
});
