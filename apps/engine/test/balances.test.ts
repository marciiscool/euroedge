import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { balanceSnapshot } from '../src/balances.ts';
import { Harness, USDC } from './fixtures.ts';

describe('hourly balance snapshot (M5-12)', () => {
  it('lists wallet accounts with positive settled cash, sorted, with the seq', () => {
    const h = Harness.booted(); // alice is a dev account: not in the tree
    const b = '0x00000000000000000000000000000000000000bb';
    const a = '0x00000000000000000000000000000000000000aa';
    h.run({ type: 'DevDeposit', account: b, amount: usdc(5n * USDC) });
    h.run({ type: 'DevDeposit', account: a, amount: usdc(7n * USDC) });
    h.run({
      type: 'DevDeposit',
      account: '0x00000000000000000000000000000000000000cc',
      amount: usdc(1n),
    });
    const s = balanceSnapshot(h.state, 498_000n);
    expect(s.hour).toBe('498000');
    expect(s.seq).toBe(h.state.seq.toString());
    expect(s.leaves.slice(0, 2)).toEqual([
      [a, '7000000'],
      [b, '5000000'],
    ]);
    expect(s.leaves.some(([acc]) => acc === 'alice')).toBe(false);
  });
});
