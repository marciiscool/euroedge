import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import { apply } from '../src/core/apply.ts';
import type { EngineInput } from '../src/core/events.ts';
import { fundingRate } from '../src/core/funding.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { createState } from '../src/core/state.ts';
import { data, listASML, order, USDC, WINDOWS } from './fixtures.ts';

const H = 3_600_000n;
const H0 = 498_056n * H; // an hour boundary shortly after the fixture epoch

function booted(listing: EngineInput = listASML) {
  const state = createState();
  let ts = H0 - 600_000n; // ten minutes before the boundary
  const run = (input: EngineInput, at?: bigint): EngineOutput[] => {
    ts = at ?? ts + 1000n;
    return apply(state, { seq: state.seq + 1n, ts, v: 1, input });
  };
  run({
    type: 'GenesisCapital',
    house: usdc(50_000_000n * USDC),
    insurance: usdc(5_000_000n * USDC),
    source: 'dev',
  });
  run(listing);
  run(data(70_000n));
  for (const a of ['alice', 'bob'])
    run({ type: 'DevDeposit', account: a, amount: usdc(10_000n * USDC) });
  return { state, run };
}
const cash = (s: ReturnType<typeof createState>, a: string) =>
  s.ledger.balance(a === SYSTEM.house ? a : userAccount(a)) as bigint;

describe('funding (ADR-0016)', () => {
  it('Window A: interest + skew, longs pay; hand-checked amount (golden vector)', () => {
    const { state, run } = booted();
    run(order('alice', 'buy', 100n)); // long 1.00 at the ask
    run(data(70_000n)); // mark 700.00
    const before = cash(state, 'alice');
    const houseBefore = cash(state, SYSTEM.house);
    const out = run({ type: 'ClockTick' }, H0 + 1000n);
    // interest 500 bp/yr → 5 707 762 557 077 (1e18/h); skew 3e14 · 7e8 / 2e12 = 1.05e11.
    expect(out.find((o) => o.type === 'FundingSettled')).toMatchObject({
      rate: 5_812_762_557_077n,
    });
    // 1.00 × 700 EUR = 7e8 µUSDC × rate / 1e18 = 4 068.93 → 4 068 µUSDC (toward zero).
    expect(before - cash(state, 'alice')).toBe(4_068n);
    expect(cash(state, SYSTEM.house) - houseBefore).toBe(4_068n);
  });

  it('Window D: interest only, no skew term', () => {
    const { state, run } = booted();
    run(order('alice', 'buy', 100n));
    run(data(70_000n, 'D'));
    const before = cash(state, 'alice');
    run({ type: 'ClockTick' }, H0);
    expect(before - cash(state, 'alice')).toBe(3_995n); // 7e8 × 5 707 762 557 077 / 1e18
  });

  it('skew can reach the cap; when users are net short the shorts pay', () => {
    const tinyCap = { ...WINDOWS.A, fundingOiCap: usdc(1n * USDC) };
    const { state, run } = booted({
      ...listASML,
      windows: { ...WINDOWS, A: tinyCap },
    } as EngineInput);
    run(order('bob', 'sell', 100n));
    run(data(70_000n));
    const m = state.markets.get('ASML-PERP');
    if (m === undefined) throw new Error('no market');
    // skew = −cap; total = clamp(interest − cap, ±cap) = −cap + interest.
    expect(fundingRate(m)).toBe(-300n * 1_000_000_000_000n + 5_707_762_557_077n);
    const before = cash(state, 'bob');
    run({ type: 'ClockTick' }, H0);
    // −1.00 × 700 EUR × (−2.94292…e14) / 1e18 = +206 004.57 → the short pays 206 004 µUSDC.
    expect(before - cash(state, 'bob')).toBe(206_004n);
  });

  it('settles every elapsed hour, zero-sum across users and the house', () => {
    const { state, run } = booted();
    run(order('alice', 'buy', 300n));
    run(order('bob', 'sell', 100n));
    run(data(70_000n));
    const internal = () => cash(state, 'alice') + cash(state, 'bob') + cash(state, SYSTEM.house);
    const sum = internal();
    const out = run({ type: 'ClockTick' }, H0 + 3n * H);
    expect(out.filter((o) => o.type === 'FundingSettled')).toHaveLength(4);
    expect(internal()).toBe(sum);
    expect(state.markets.get('ASML-PERP')?.funding.lastHour).toBe(H0 / H + 3n);
  });
});

describe('golden vectors: funding (docs/methodology/examples/funding.json)', () => {
  it('matches every hand-derived case', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fundingPayment, hourlyFundingRate } = await import('../src/core/funding.ts');
    const f = JSON.parse(
      await readFile(
        new URL('../../../docs/methodology/examples/funding.json', import.meta.url),
        'utf8',
      ),
    ) as {
      cases: {
        name: string;
        interestBpsPerYear: number;
        capPpmPerHour: number | null;
        oiCapMicroUsdc: string;
        netSkewMicroUsdc: string;
        notionalMicroUsdc: string;
        rate: string;
        paymentMicroUsdc: string;
      }[];
    };
    for (const c of f.cases) {
      const rate = hourlyFundingRate({
        interestBpsPerYear: BigInt(c.interestBpsPerYear),
        capPpmPerHour: c.capPpmPerHour === null ? null : BigInt(c.capPpmPerHour),
        oiCap: BigInt(c.oiCapMicroUsdc),
        netSkew: BigInt(c.netSkewMicroUsdc),
      });
      expect(rate, c.name).toBe(BigInt(c.rate));
      expect(fundingPayment(BigInt(c.notionalMicroUsdc), rate), c.name).toBe(
        BigInt(c.paymentMicroUsdc),
      );
    }
  });
});
