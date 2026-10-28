import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { Ledger, SYSTEM, userAccount } from './ledger.ts';

const accounts = [
  SYSTEM.house,
  SYSTEM.insurance,
  SYSTEM.fees,
  SYSTEM.external,
  userAccount('a'),
  userAccount('b'),
];
const posting = fc.record({
  from: fc.constantFrom(...accounts),
  to: fc.constantFrom(...accounts),
  amount: fc.bigInt({ min: 1n, max: 10n ** 12n }).map(usdc),
  reason: fc.constantFrom('deposit', 'fee', 'realized-pnl'),
});

describe('Ledger', () => {
  it('moves value between accounts', () => {
    const l = new Ledger();
    l.post([
      { from: SYSTEM.external, to: userAccount('a'), amount: usdc(10_000_000n), reason: 'deposit' },
    ]);
    l.post([{ from: userAccount('a'), to: SYSTEM.fees, amount: usdc(5_000n), reason: 'fee' }]);
    expect(l.balance(userAccount('a'))).toBe(9_995_000n);
    expect(l.balance(SYSTEM.fees)).toBe(5_000n);
    expect(l.internalTotal()).toBe(10_000_000n);
    expect(l.netExternalInflow()).toBe(10_000_000n);
    expect(l.entries().map(([a]) => a)).toEqual(['external:vault', 'fees', 'user:a']);
  });

  it('rejects invalid batches atomically', () => {
    const l = new Ledger();
    l.post([{ from: SYSTEM.external, to: SYSTEM.house, amount: usdc(100n), reason: 'genesis' }]);
    const before = l.entries();
    expect(() =>
      l.post([
        { from: SYSTEM.house, to: userAccount('a'), amount: usdc(10n), reason: 'realized-pnl' },
        { from: SYSTEM.house, to: userAccount('a'), amount: usdc(0n), reason: 'realized-pnl' },
      ]),
    ).toThrow(/> 0/);
    expect(() =>
      l.post([{ from: SYSTEM.house, to: SYSTEM.house, amount: usdc(1n), reason: 'fee' }]),
    ).toThrow(/both/);
    expect(l.entries()).toEqual(before);
  });

  it('Σ all balances is always 0 and internal total equals net external inflow (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.array(posting, { maxLength: 4 }), { maxLength: 200 }), (batches) => {
        const l = new Ledger();
        for (const batch of batches) {
          try {
            l.post(batch);
          } catch {
            // invalid batches (from === to) are rejected atomically
          }
        }
        const all = l.entries().reduce((s, [, b]) => s + b, 0n);
        expect(all).toBe(0n);
        expect(l.internalTotal()).toBe(l.netExternalInflow());
      }),
    );
  });
});

describe('Ledger edge cases', () => {
  it('reports zero for unknown accounts and an empty ledger', () => {
    const l = new Ledger();
    expect(l.balance('user:nobody')).toBe(0n);
    expect(l.netExternalInflow()).toBe(0n);
    expect(l.internalTotal()).toBe(0n);
    expect(l.entries()).toEqual([]);
  });

  it('sorts snapshot entries regardless of posting order', () => {
    const l = new Ledger();
    l.post([{ from: userAccount('z'), to: userAccount('b'), amount: usdc(1n), reason: 'fee' }]);
    l.post([{ from: userAccount('a'), to: userAccount('c'), amount: usdc(1n), reason: 'fee' }]);
    expect(l.entries().map(([a]) => a)).toEqual(['user:a', 'user:b', 'user:c', 'user:z']);
  });

  it('rebuilds an identical ledger from its entries (state snapshots)', () => {
    const l = new Ledger();
    l.post([{ from: SYSTEM.external, to: userAccount('a'), amount: usdc(7n), reason: 'deposit' }]);
    l.post([{ from: userAccount('a'), to: SYSTEM.fees, amount: usdc(2n), reason: 'fee' }]);
    const r = Ledger.fromEntries(l.entries());
    expect(r.entries()).toEqual(l.entries());
    expect(r.internalTotal()).toBe(7n);
    expect(r.netExternalInflow()).toBe(7n);
  });
});
