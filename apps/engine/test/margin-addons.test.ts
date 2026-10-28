import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import type { EngineInput, WindowRisk } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { withdrawable } from '../src/core/withdrawals.ts';
import { marketSnapshot } from '../src/snapshots.ts';
import { data, Harness, listASML, order, USDC, WINDOWS } from './fixtures.ts';

function harness(a: Partial<WindowRisk> = {}): Harness {
  const h = Harness.booted();
  h.run({ ...listASML, windows: { ...WINDOWS, A: { ...WINDOWS.A, ...a } } } as EngineInput);
  for (const acc of ['bob', '0x00000000000000000000000000000000000a11ce'])
    h.run({ type: 'DevDeposit', account: acc, amount: usdc(100_000n * USDC) });
  return h;
}
const reason = (out: EngineOutput[]) => {
  const r = out.find((o) => o.type === 'OrderRejected');
  return r?.type === 'OrderRejected' ? r.reason : undefined;
};
const filled = (out: EngineOutput[]) => out.some((o) => o.type === 'OrderFilled');

describe('gross open-interest cap (M4-08)', () => {
  it('refuses exposure past the cap in either direction; reducing always works', () => {
    // Cap 14 000 USDC at mark 700: 20 shares of gross OI.
    const h = harness({ oiCap: usdc(14_000n * USDC) });
    expect(filled(h.run(order('alice', 'buy', 1_000n)))).toBe(true); // 10 shares
    expect(filled(h.run(order('bob', 'sell', 1_000n)))).toBe(true); // 20 gross
    expect(reason(h.run(order('bob', 'sell', 100n)))).toBe('oi-cap');
    expect(reason(h.run(order('alice', 'buy', 100n)))).toBe('oi-cap');
    expect(filled(h.run(order('alice', 'sell', 500n, { reduceOnly: true })))).toBe(true);
    expect(filled(h.run(order('bob', 'sell', 500n)))).toBe(true); // room again
  });
});

describe('earnings leverage step (M4-08)', () => {
  const step = (h: Harness, from: bigint, to: bigint, maxLeverage = 2n): EngineInput => ({
    type: 'EarningsWindow',
    market: 'ASML-PERP',
    id: 'q3',
    startTs: h.state.ts + from,
    endTs: h.state.ts + to,
    maxLeverage,
  });

  it('caps new exposure at the stepped leverage only inside the window', () => {
    const h = harness();
    h.run(step(h, 3_000n, 60_000n)); // opens two events from now
    // alice: 10 000 USDC. 60 shares ≈ 42 000 notional = 4.2×: fine before the window opens…
    expect(filled(h.run(order('alice', 'buy', 6_000n)))).toBe(true);
    // …inside it (2×) one more share would need ≈ 21 350 IM: refused.
    expect(reason(h.run(order('alice', 'buy', 100n)))).toBe('insufficient-margin');
    expect(marketSnapshot(h.state, 'ASML-PERP')?.maxLeverage).toBe(2);
    h.skip(60_000n).run(data(70_000n));
    expect(marketSnapshot(h.state, 'ASML-PERP')?.maxLeverage).toBe(5);
    expect(filled(h.run(order('alice', 'buy', 100n)))).toBe(true);
  });

  it('applies to withdrawals too: free collateral shrinks during the window', () => {
    const W = '0x00000000000000000000000000000000000a11ce';
    const h = harness();
    h.run(order(W, 'buy', 10_000n)); // 100 shares ≈ 70 000
    const before = withdrawable(h.state, W) as bigint;
    h.run(step(h, 0n, 60_000n));
    h.run({ type: 'ClockTick' });
    // IM goes from 70 000 / 5 to 70 000 / 2: 21 000 USDC less can leave.
    expect(before - (withdrawable(h.state, W) as bigint)).toBeGreaterThan(20_000n * USDC);
  });

  it('ignores an empty window or an unknown market', () => {
    const h = harness();
    expect(h.run(step(h, 5n, 5n))[0]).toMatchObject({
      type: 'InputIgnored',
      reason: 'empty window',
    });
    const other = { ...step(h, 0n, 10n), market: 'NOPE-PERP' } as EngineInput;
    expect(h.run(other)[0]).toMatchObject({ reason: 'unknown market' });
  });
});
