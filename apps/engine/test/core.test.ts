import { describe, expect, it } from 'vitest';
import { usdc } from '@euroedge/fixed';
import { SYSTEM, userAccount } from '@euroedge/ledger';
import { accountEquity, houseEquity } from '../src/core/accounting.ts';
import { apply } from '../src/core/apply.ts';
import { assertInvariants, InvariantViolation } from '../src/core/invariants.ts';
import { data, Harness, order, USDC } from './fixtures.ts';

const filled = (out: ReturnType<Harness['run']>) => out.find((o) => o.type === 'OrderFilled');
const rejected = (out: ReturnType<Harness['run']>) => out.find((o) => o.type === 'OrderRejected');

describe('engine core — orders', () => {
  it('buys at the house ask, charges the taker fee, closes with exact PnL', () => {
    const h = Harness.booted();
    // Window A: FV 700.00, half-spread 5 bp → ask = ceil(70000 · 1.0005) = 70035 (700.35)
    const buy = filled(h.run(order('alice', 'buy', 150n)));
    expect(buy?.type === 'OrderFilled' && buy.fill).toMatchObject({ price: 70_035n, qty: 150n });
    // fee = ceil(150 · 70035 · 100 µUSDC · 5 bp) = ceil(1 050 525 000 · 5 / 10 000) = 525 263
    expect(buy?.type === 'OrderFilled' && buy.fill.fee).toBe(525_263n);
    // Mark moves to 710.00 (bid = floor(71000 · 0.9995) = 70964), close.
    h.run(data(71_000n));
    const close = filled(
      h.run({
        type: 'ClosePosition',
        requestId: 'c',
        idempotencyKey: 'c',
        account: 'alice',
        market: 'ASML-PERP',
      }),
    );
    // realized = (70964 − 70035) · 150 lots · 100 µUSDC = 13 935 000 µUSDC
    expect(close?.type === 'OrderFilled' && close.fill.realized).toBe(13_935_000n);
    const fees = h.state.ledger.balance(SYSTEM.fees);
    expect(h.state.ledger.balance(userAccount('alice'))).toBe(10_000n * USDC + 13_935_000n - fees);
    expect(h.state.markets.get('ASML-PERP')?.house).toEqual({ lots: 0n, cost: 0n });
  });

  it('enforces the window leverage cap on new exposure (5x in A, 2x in D)', () => {
    const h = Harness.booted();
    // 10 000 USDC equity; at 700 the 5x cap allows ≈ 71 shares (7 100 lots) after spread/fee.
    expect(rejected(h.run(order('alice', 'buy', 7_200n)))).toMatchObject({
      reason: 'insufficient-margin',
    });
    expect(filled(h.run(order('alice', 'buy', 7_000n)))).toBeDefined();
    const h2 = Harness.booted();
    h2.run(data(70_000n, 'D'));
    expect(rejected(h2.run(order('alice', 'buy', 3_000n)))).toMatchObject({
      reason: 'insufficient-margin',
    });
    expect(filled(h2.run(order('alice', 'buy', 2_700n)))).toBeDefined();
  });

  it('rejects below min notional, reduce-only violations and closing a flat position', () => {
    const h = Harness.booted();
    expect(rejected(h.run(order('alice', 'buy', 1n)))).toMatchObject({ reason: 'min-notional' });
    expect(rejected(h.run(order('alice', 'sell', 100n, { reduceOnly: true })))).toMatchObject({
      reason: 'reduce-only',
    });
    expect(
      rejected(
        h.run({
          type: 'ClosePosition',
          requestId: 'x',
          idempotencyKey: 'x',
          account: 'alice',
          market: 'ASML-PERP',
        }),
      ),
    ).toMatchObject({ reason: 'no-position' });
    expect(rejected(h.run(order('bob', 'buy', 100n)))).toMatchObject({ reason: 'unknown-account' });
  });

  it('rejects fills outside priceLimit vs the index', () => {
    const h = Harness.booted();
    // Window D limit 3 %: index far below FV makes the ask breach it.
    h.run(data(70_000n, 'D', 500n, 70_000n, 67_000n));
    expect(rejected(h.run(order('alice', 'buy', 100n)))).toMatchObject({ reason: 'price-limit' });
  });

  it('is idempotent: a duplicate key returns the first outcome without a second fill', () => {
    const h = Harness.booted();
    const first = h.run(order('alice', 'buy', 100n, { key: 'same' }));
    const again = h.run(order('alice', 'buy', 100n, { key: 'same' }));
    expect(filled(again)).toMatchObject({ duplicate: true });
    expect(filled(first)).toMatchObject({ duplicate: false });
    expect(h.state.accounts.get('alice')?.positions.get('ASML-PERP')?.lots).toBe(100n);
  });

  it('refuses orders before genesis', () => {
    const h = new Harness();
    expect(rejected(h.run(order('alice', 'buy', 100n)))).toMatchObject({ reason: 'not-genesis' });
  });
});

describe('engine core — liquidation and protection', () => {
  it('liquidates below maintenance margin at mark; insurance covers the shortfall; equity ends at 0', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 7_000n)); // ≈ 4.9x long
    const insuranceBefore = h.state.ledger.balance(SYSTEM.insurance);
    // A 30 % gap down (band re-centred, as at a snap): far past bankruptcy.
    const out = h.run(data(49_000n, 'A', 500n));
    const liq = out.find((o) => o.type === 'Liquidated');
    expect(liq).toMatchObject({ account: 'alice', markets: ['ASML-PERP'] });
    expect(liq?.type === 'Liquidated' && liq.insuranceCover).toBeGreaterThan(0n);
    expect(accountEquity(h.state, 'alice')).toBe(0n);
    expect(h.state.ledger.balance(SYSTEM.insurance)).toBeLessThan(insuranceBefore);
    expect(h.state.accounts.get('alice')?.positions.get('ASML-PERP')).toEqual({
      lots: 0n,
      cost: 0n,
    });
  });

  it('charges the 1 % penalty to insurance when equity covers it', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 7_000n));
    // ≈ 15 % drop: equity < MM (10 %) but still positive.
    const out = h.run(data(61_000n, 'A', 500n));
    const liq = out.find((o) => o.type === 'Liquidated');
    expect(liq?.type === 'Liquidated' && liq.penalty).toBeGreaterThan(0n);
    expect(liq?.type === 'Liquidated' && liq.insuranceCover).toBe(0n);
  });

  it('counts the house cost basis when the house is flat in lots (regression)', () => {
    // Found by the property harness: one user long, another short at a different price →
    // house lots 0, cost ≠ 0. That embedded value must be part of house equity (Invariant 7).
    const h = Harness.booted();
    h.run({ type: 'DevDeposit', account: 'bob', amount: usdc(10_000n * USDC) });
    h.run(order('alice', 'buy', 100n), data(72_000n), order('bob', 'sell', 100n));
    const m = h.state.markets.get('ASML-PERP');
    expect(m?.house.lots).toBe(0n);
    expect(m?.house.cost).not.toBe(0n);
    const cash = h.state.ledger.balance(SYSTEM.house);
    expect(houseEquity(h.state)).toBe(cash - (m?.house.cost ?? 0n) * 100n);
    expect(() => assertInvariants(h.state)).not.toThrow();
  });

  it('keeps the house solvent and the mirror exact', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 2_000n), data(70_500n), order('alice', 'sell', 500n));
    expect(houseEquity(h.state)).toBeGreaterThan(0n);
    expect(() => assertInvariants(h.state)).not.toThrow();
  });
});

describe('engine core — guards', () => {
  it('ignores market data whose mark lies outside the band (Invariant 5 at the boundary)', () => {
    const h = Harness.booted();
    const out = h.run(data(70_000n, 'A', 100n, 71_000n));
    expect(out).toEqual([
      { type: 'InputIgnored', input: 'MarketData', reason: 'mark outside band' },
    ]);
  });

  it('detects a corrupted state', () => {
    const h = Harness.booted();
    h.state.ledger.post([{ from: SYSTEM.house, to: SYSTEM.fees, amount: usdc(1n), reason: 'fee' }]);
    expect(() => assertInvariants(h.state)).not.toThrow(); // internal transfers keep Invariant 1
    h.state.netDeposits += 1n;
    expect(() => assertInvariants(h.state)).toThrow(InvariantViolation);
  });

  it('rejects out-of-order sequence numbers and time going backwards', () => {
    const h = Harness.booted();
    const seq = h.state.seq;
    expect(() =>
      apply(h.state, { seq: seq + 2n, ts: h.state.ts + 1n, v: 1, input: { type: 'ClockTick' } }),
    ).toThrow(/out-of-order/);
    expect(() =>
      apply(h.state, { seq: seq + 1n, ts: h.state.ts - 1n, v: 1, input: { type: 'ClockTick' } }),
    ).toThrow(/backwards/);
  });
});
