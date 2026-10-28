import { describe, expect, it } from 'vitest';
import { abs, ticks, usdc } from '@euroedge/fixed';
import { accountEquity } from '../src/core/accounting.ts';
import type { EngineInput } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { data, Harness, order, USDC } from './fixtures.ts';

const freeze = (actionId = 'split-1'): EngineInput => ({
  type: 'CorporateActionFreeze',
  market: 'ASML-PERP',
  actionId,
});
const adjust = (ratioNum: bigint, ratioDen: bigint, actionId = 'split-1'): EngineInput => ({
  type: 'CorporateActionAdjust',
  market: 'ASML-PERP',
  actionId,
  ratioNum,
  ratioDen,
});
const unfreeze = (actionId = 'split-1'): EngineInput => ({
  type: 'CorporateActionUnfreeze',
  market: 'ASML-PERP',
  actionId,
});
const pos = (h: Harness, a: string) => h.state.accounts.get(a)?.positions.get('ASML-PERP');
const reason = (out: EngineOutput[]) => {
  const r = out.find((o) => o.type === 'OrderRejected' || o.type === 'InputIgnored');
  return r?.type === 'OrderRejected' || r?.type === 'InputIgnored' ? r.reason : undefined;
};

function book(longLots: bigint, shortLots: bigint): Harness {
  const h = Harness.booted();
  h.run({ type: 'DevDeposit', account: 'bob', amount: usdc(10_000n * USDC) });
  h.run(order('alice', 'buy', longLots), order('bob', 'sell', shortLots));
  return h;
}

describe('corporate actions (M4-17)', () => {
  it('2:1 split: lots double, prices halve, cost and equity unchanged', () => {
    const h = book(1_000n, 400n);
    const resting = {
      ...(order('alice', 'buy', 100n, { key: 'L' }) as Extract<
        EngineInput,
        { type: 'PlaceOrder' }
      >),
      limitPrice: ticks(69_000n),
    };
    h.run(resting);
    const [ea, eb, cost] = [
      accountEquity(h.state, 'alice'),
      accountEquity(h.state, 'bob'),
      pos(h, 'alice')?.cost,
    ];

    const frozen = h.run(freeze());
    expect(frozen.find((o) => o.type === 'OrderCancelled')).toMatchObject({
      reason: 'corporate-action',
    });
    expect(reason(h.run(order('alice', 'sell', 100n, { reduceOnly: true })))).toBe('market-frozen');

    h.run(adjust(2n, 1n));
    expect(pos(h, 'alice')).toEqual({ lots: 2_000n, cost });
    expect(pos(h, 'bob')?.lots).toBe(-800n);
    expect(h.state.markets.get('ASML-PERP')?.data?.mark).toBe(35_000n);
    expect(accountEquity(h.state, 'alice')).toBe(ea);
    expect(accountEquity(h.state, 'bob')).toBe(eb);
    expect(h.state.markets.get('ASML-PERP')?.house.lots).toBe(-1_200n);

    h.run(unfreeze(), data(35_000n));
    expect(h.run(order('alice', 'sell', 2_000n)).some((o) => o.type === 'OrderFilled')).toBe(true);
  });

  it('3:2 split: the leftover half lot is cash-settled at the adjusted mark', () => {
    const h = book(1_001n, 0n);
    const before = accountEquity(h.state, 'alice');
    h.run(freeze(), adjust(3n, 2n));
    // 1 001 × 3 / 2 = 1 501.5 → 1 501 lots, half a lot paid out in cash.
    expect(pos(h, 'alice')?.lots).toBe(1_501n);
    // Only the mark rounding (⅔ of a tick) moves equity: < 1 tick per lot.
    const drift = abs(accountEquity(h.state, 'alice') - before);
    expect(drift).toBeLessThan(1_501n * 100n);
  });

  it('1:10 reverse split keeps equity within rounding', () => {
    const h = book(1_005n, 2_003n);
    const [ea, eb] = [accountEquity(h.state, 'alice'), accountEquity(h.state, 'bob')];
    h.run(freeze(), adjust(1n, 10n));
    expect(pos(h, 'alice')?.lots).toBe(100n);
    expect(pos(h, 'bob')?.lots).toBe(-200n);
    expect(h.state.markets.get('ASML-PERP')?.data?.mark).toBe(700_000n);
    expect(abs(accountEquity(h.state, 'alice') - ea)).toBeLessThan(100n * 100n);
    expect(abs(accountEquity(h.state, 'bob') - eb)).toBeLessThan(200n * 100n);
  });

  it('enforces the order: freeze → adjust once → unfreeze, matching action ids', () => {
    const h = book(1_000n, 0n);
    expect(reason(h.run(adjust(2n, 1n)))).toBe('not frozen for this action');
    h.run(freeze());
    expect(reason(h.run(freeze('other')))).toBe('already frozen for split-1');
    expect(reason(h.run(adjust(2n, 1n, 'other')))).toBe('not frozen for this action');
    h.run(adjust(2n, 1n));
    expect(reason(h.run(adjust(2n, 1n)))).toBe('already adjusted');
    expect(reason(h.run(unfreeze('other')))).toBe('not frozen for this action');
    h.run(unfreeze());
    expect(h.state.markets.get('ASML-PERP')?.corporateAction).toBeNull();
  });
});
