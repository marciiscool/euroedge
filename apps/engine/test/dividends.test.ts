import { describe, expect, it } from 'vitest';
import { ticks, usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import type { EngineInput } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { decodeEvent, encodeEvent, EVENT_VERSIONS } from '../src/log/codec.ts';
import { Harness, order, USDC } from './fixtures.ts';

const dividend = (gross: bigint, withholdingBps = 1_500n, exDate = '2026-11-02'): EngineInput => ({
  type: 'DividendExDate',
  market: 'ASML-PERP',
  exDate,
  grossPerShare: ticks(gross),
  withholdingBps,
});
const cash = (h: Harness, a: string) => h.state.ledger.balance(userAccount(a)) as bigint;
const applied = (out: EngineOutput[]) => out.find((o) => o.type === 'DividendApplied');

function positions(): Harness {
  const h = Harness.booted();
  h.run({ type: 'DevDeposit', account: 'bob', amount: usdc(10_000n * USDC) });
  h.run(order('alice', 'buy', 1_000n), order('bob', 'sell', 500n)); // +10 / −5 shares
  return h;
}

describe('dividends (M4-16)', () => {
  it('longs receive net of withholding, shorts pay gross, the house the other side', () => {
    const h = positions();
    const [a, b, house] = [cash(h, 'alice'), cash(h, 'bob'), h.state.ledger.balance(SYSTEM.house)];
    // €1.50 = 150 ticks; 1 000 lots × 150 × 100 µUSDC = 15 USDC gross, 85 % = 12.75 USDC.
    expect(applied(h.run(dividend(150n)))).toMatchObject({
      paidToLongs: 12_750_000n,
      paidByShorts: 7_500_000n, // 500 lots × 150 × 100 = 7.50 USDC
    });
    expect(cash(h, 'alice') - a).toBe(12_750_000n);
    expect(cash(h, 'bob') - b).toBe(-7_500_000n);
    expect(h.state.ledger.balance(SYSTEM.house) - house).toBe(-5_250_000n);
  });

  it('truncates what longs receive (house-favourable)', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 1_000n));
    const before = cash(h, 'alice');
    // 1 tick per share: gross 1 000 × 1 × 100 = 100 000 µUSDC; × 0.6667 = 66 670.
    h.run(dividend(1n, 3_333n));
    expect(cash(h, 'alice') - before).toBe(66_670n);
  });

  it('applies once per market and ex-date', () => {
    const h = positions();
    h.run(dividend(150n));
    const again = h.run(dividend(150n));
    expect(again.find((o) => o.type === 'InputIgnored')).toMatchObject({
      reason: 'dividend already applied',
    });
    expect(applied(h.run(dividend(150n, 1_500n, '2027-02-01')))).toBeDefined();
  });

  it('ignores unknown markets and survives the log codec', () => {
    const h = positions();
    const unknown = { ...dividend(150n), market: 'NOPE-PERP' } as EngineInput;
    expect(h.run(unknown)[0]).toMatchObject({ type: 'InputIgnored', reason: 'unknown market' });
    const e = { seq: 1n, ts: 0n, v: EVENT_VERSIONS.DividendExDate, input: dividend(150n) };
    expect(decodeEvent(encodeEvent(e))).toEqual(e);
    expect(() => decodeEvent(encodeEvent({ ...e, input: dividend(150n, 10_001n) }))).toThrow();
  });
});
