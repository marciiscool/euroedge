import { describe, expect, it } from 'vitest';
import { ticks, usdc } from '@euroedge/fixed';
import { SYSTEM } from '@euroedge/ledger';
import { accountEquity, houseEquity } from '../src/core/accounting.ts';
import type { EngineInput } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { data, Harness, order, USDC } from './fixtures.ts';

/**
 * Stress scenarios (M4-27). `apply` asserts Invariants 1–10 after every event, so each
 * scenario also proves solvency, no negative user equity and house/insurance ≥ 0 throughout.
 */
const count = (out: EngineOutput[], type: EngineOutput['type']) =>
  out.filter((o) => o.type === type).length;
const insurance = (h: Harness) => h.state.ledger.balance(SYSTEM.insurance) as bigint;
const lotsOf = (h: Harness, a: string) =>
  h.state.accounts.get(a)?.positions.get('ASML-PERP')?.lots ?? 0n;

function crowd(longs: number, shorts: number): Harness {
  const h = Harness.booted();
  for (let i = 0; i < longs + shorts; i++) {
    const a = `t${i}`;
    h.run({ type: 'DevDeposit', account: a, amount: usdc(2_000n * USDC) });
    // ≈ 13.5 shares at 700 = 9 450 USDC: close to 5× on 2 000 USDC.
    h.run(order(a, i < longs ? 'buy' : 'sell', 1_350n));
  }
  return h;
}

describe('stress scenarios (M4-27)', () => {
  it('Monday −25 % gap after a window-D weekend: longs liquidated, insurance absorbs, solvent', () => {
    const h = crowd(40, 10);
    expect([...Array(50).keys()].every((i) => lotsOf(h, `t${i}`) !== 0n)).toBe(true);
    h.run(data(70_000n, 'D')); // weekend
    const before = insurance(h);
    const out = h.run(data(52_500n, 'A')); // Monday open, −25 %
    expect(count(out, 'Liquidated')).toBeGreaterThanOrEqual(40);
    for (let i = 0; i < 40; i++) expect(lotsOf(h, `t${i}`)).toBe(0n);
    // Each long lost ≈ 2 360 USDC on 2 000 of margin: the shortfall comes from insurance.
    expect(insurance(h)).toBeLessThan(before);
    for (let i = 0; i < 50; i++) expect(accountEquity(h.state, `t${i}`)).toBeGreaterThanOrEqual(0n);
    // The shorts keep their positions and their gains.
    for (let i = 40; i < 50; i++) expect(lotsOf(h, `t${i}`)).toBe(-1_350n);
  });

  it('bad print held by a reduce-only breaker: no liquidations, no opens, exits still work', () => {
    const h = crowd(5, 5);
    // A raw bad print (FV far outside its band) never enters the state.
    const bad = {
      ...(data(70_000n) as Extract<EngineInput, { type: 'MarketData' }>),
      fv: ticks(91_000n),
    };
    const ignored = h.run(bad);
    expect(ignored[0]).toMatchObject({ type: 'InputIgnored', reason: 'fv outside band' });
    expect(count(ignored, 'Liquidated')).toBe(0);
    // fv-service flags it: same band, reduce-only breaker until the price is confirmed.
    const flagged = {
      ...(data(70_000n) as Extract<EngineInput, { type: 'MarketData' }>),
      breaker: 'reduce-only' as const,
    };
    expect(count(h.run(flagged), 'Liquidated')).toBe(0);
    // alice is flat with free margin: a new position is refused while the breaker is on.
    expect(
      h.run(order('alice', 'buy', 100n)).find((o) => o.type === 'OrderRejected'),
    ).toMatchObject({
      reason: 'circuit-breaker',
    });
    expect(count(h.run(order('t5', 'buy', 100n, { reduceOnly: true })), 'OrderFilled')).toBe(1);
    // The clean tick clears it.
    h.run(data(70_000n));
    expect(count(h.run(order('alice', 'buy', 100n)), 'OrderFilled')).toBe(1);
  });

  it('6-hour feed outage: funding still settles hourly on the last mark, state stays sound', () => {
    const h = crowd(10, 2);
    let fundings = 0;
    for (let hour = 0; hour < 6; hour++) {
      fundings += count(h.skip(3_600_000n).run({ type: 'ClockTick' }), 'FundingSettled');
    }
    expect(fundings).toBe(6);
    // Data returns with the stale breaker still on (no opens) and then clears.
    const back = {
      ...(data(70_000n) as Extract<EngineInput, { type: 'MarketData' }>),
      breaker: 'no-opens' as const,
    };
    expect(count(h.run(back), 'Liquidated')).toBe(0);
    expect(houseEquity(h.state)).toBeGreaterThan(0n);
  });

  it('ex-dividend day: the price drop and the cash flow net out, except the withholding', () => {
    const h = Harness.booted();
    h.run({ type: 'DevDeposit', account: 'bob', amount: usdc(10_000n * USDC) });
    h.run(order('alice', 'buy', 1_000n), order('bob', 'sell', 1_000n)); // ±10 shares; house flat
    const eq = (): [bigint, bigint, bigint] => [
      accountEquity(h.state, 'alice'),
      accountEquity(h.state, 'bob'),
      houseEquity(h.state),
    ];
    const [a0, b0, h0] = eq();
    // €1.50 dividend: FV and mark drop by 150 ticks, cash moves the same instant.
    h.run(
      {
        type: 'DividendExDate',
        market: 'ASML-PERP',
        exDate: '2026-11-02',
        grossPerShare: ticks(150n),
        withholdingBps: 1_500n,
      },
      data(69_850n),
    );
    const [a1, b1, h1] = eq();
    expect(a1 - a0).toBe(-2_250_000n); // long: −15 uPnL + 12.75 cash = −2.25 (withholding)
    expect(b1 - b0).toBe(0n); // short: +15 uPnL − 15 cash
    expect(h1 - h0).toBe(2_250_000n); // the house keeps the withholding
  });
});
