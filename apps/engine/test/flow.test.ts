import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import type { EngineInput } from '../src/core/events.ts';
import { flowShift } from '../src/core/flow.ts';
import { marketSnapshot } from '../src/snapshots.ts';
import { data, Harness, listASML, order, USDC } from './fixtures.ts';

/** Proposed flow parameters: κ 100 ppm per 1 M USDC, τ 300 s, 250 000 USDC per wallet per 60 s. */
function harness(): Harness {
  const h = new Harness();
  h.run(
    {
      type: 'GenesisCapital',
      house: usdc(50_000_000n * USDC),
      insurance: usdc(5_000_000n * USDC),
      source: 'dev',
    },
    {
      ...listASML,
      flow: {
        kappaPpmPerMUsdc: 100n,
        tauSec: 300n,
        walletCap: usdc(250_000n * USDC),
        walletWindowSec: 60n,
      },
    } as EngineInput,
    data(70_000n),
  );
  for (const a of ['alice', 'bob', 'carol', 'dave'])
    h.run({ type: 'DevDeposit', account: a, amount: usdc(1_000_000n * USDC) });
  return h;
}

const asml = (h: Harness) => {
  const m = h.state.markets.get('ASML-PERP');
  if (m === undefined) throw new Error('no market');
  return m;
};

describe('flow shift (M4-03)', () => {
  it('shifts the quotes, never FV or mark, by κ per 1 M USDC of net flow', () => {
    const h = harness();
    // 350 shares at 700.35 = 245 122.50 USDC → 24.5 → 24 ppm.
    h.run(order('alice', 'buy', 35_000n));
    expect(flowShift(asml(h), h.state.ts)).toBe(24n);
    const snap = marketSnapshot(h.state, 'ASML-PERP');
    expect(snap?.ask).toBe('700.37'); // ⌈70 000 × (1 + 500 + 24 ppm)⌉ = ⌈70 036.68⌉
    expect(snap?.bid).toBe('699.66'); // ⌊70 000 × (1 − 500 + 24 ppm)⌋ = ⌊69 966.68⌋
    expect([snap?.fv, snap?.mark]).toEqual(['700.00', '700.00']);
  });

  it('caps each wallet per window; other wallets and later windows count again', () => {
    const h = harness();
    h.run(order('alice', 'buy', 35_000n), order('alice', 'buy', 35_000n));
    expect(asml(h).flow.wallets.get('alice')).toBe(250_000n * USDC); // capped
    // 245 122.50 decayed 1 s (× 299/300) + the 4 877.50 left under the cap = 249 183 → 24 ppm.
    expect(flowShift(asml(h), h.state.ts)).toBe(24n);
    h.run(order('bob', 'sell', 35_000n)); // bob's sell offsets alice's buys
    expect(flowShift(asml(h), h.state.ts)).toBeLessThan(1n);
    h.skip(60_000n).run(order('alice', 'buy', 1_000n));
    expect(asml(h).flow.wallets.get('alice')).toBeLessThan(10_000n * USDC); // new window
  });

  it('decays with τ = 300 s: after 300 s about e^{-1} of it is left', () => {
    const h = harness();
    h.run(order('alice', 'buy', 35_000n));
    expect(flowShift(asml(h), h.state.ts + 300_000n)).toBe(9n); // 24.5 × 0.367 = 9.0
    expect(flowShift(asml(h), h.state.ts + 3_600_000n)).toBe(0n);
  });

  it('is clamped to half the half-spread', () => {
    const h = harness();
    for (const a of ['alice', 'bob', 'carol', 'dave']) h.run(order(a, 'buy', 35_000n));
    expect(flowShift(asml(h), h.state.ts)).toBe(97n); // ≈ 4 × 245 000 USDC, decayed 1 s apart
    h.run({ ...data(70_000n), sigmaPpm: 0n } as EngineInput);
    // Raw shift 97 ppm stays under h/2 = 250 ppm; with κ × 10 it would clamp at 250.
    const m = asml(h);
    const big = { ...m, flowParams: { ...m.flowParams, kappaPpmPerMUsdc: 1_000n } };
    expect(flowShift(big, h.state.ts)).toBe(972n);
    h.state.markets.set('ASML-PERP', big);
    expect(marketSnapshot(h.state, 'ASML-PERP')?.ask).toBe('700.53'); // ⌈70 000 × 1.00075⌉ = 70 052.5
  });
});
