import { describe, expect, it } from 'vitest';
import { ticks, usdc } from '@euroedge/fixed';
import type { EngineInput } from '../src/core/events.ts';
import { project, type ProjectedOutput } from '../src/projections.ts';
import { data, Harness, order, USDC } from './fixtures.ts';

/** Runs inputs and returns every output with its seq and ts, as the engine loop sees them. */
function outputs(h: Harness, ...inputs: EngineInput[]): ProjectedOutput[] {
  return inputs.flatMap((input) => {
    const out = h.run(input);
    return out.map((output) => ({ seq: h.state.seq, ts: h.state.ts, output }));
  });
}

describe('read-model projections (M4-22)', () => {
  it('projects fills, order lifecycle, cash flows and liquidations', () => {
    const h = Harness.booted();
    const W = '0x00000000000000000000000000000000000a11ce';
    h.run({ type: 'DevDeposit', account: W, amount: usdc(1_000n * USDC) });
    const placed = {
      ...(order('alice', 'buy', 100n, { key: 'L1' }) as Extract<
        EngineInput,
        { type: 'PlaceOrder' }
      >),
      limitPrice: ticks(69_000n),
    };
    const rows = project([
      ...outputs(h, order('alice', 'buy', 6_500n), placed, {
        type: 'CancelOrder',
        requestId: 'x',
        account: 'alice',
        orderId: 'L1',
      }),
      ...outputs(h, order('alice', 'buy', 10_000_000n)), // rejected: insufficient margin
      ...outputs(h, {
        type: 'DividendExDate',
        market: 'ASML-PERP',
        exDate: '2026-11-02',
        grossPerShare: ticks(150n),
        withholdingBps: 1_500n,
      }),
      ...outputs(h, {
        type: 'RequestWithdrawal',
        requestId: 'w1',
        account: W,
        amount: usdc(100n * USDC),
      }),
      ...outputs(h, { type: 'WithdrawalExecuted', withdrawalId: `${W}:w1` }),
      ...outputs(h, data(56_000n)), // −20 %: alice (≈ 4.5×) is liquidated
    ]);
    expect(rows.fills).toHaveLength(1);
    expect(rows.fills[0]?.slice(3, 7)).toEqual(['alice', 'ASML-PERP', 'buy', 6_500n]);
    expect(rows.orders.map((r) => r[6])).toEqual(['accepted', 'cancelled', 'rejected']);
    expect(rows.orders[1]?.[7]).toBe('user');
    expect(rows.cashFlows.map((r) => [r[4], r[7]])).toEqual([
      ['dividend', 82_875_000n], // 6 500 lots × 150 × 100 × 0.85,
      ['withdrawal-reserved', -100_000_000n],
      ['withdrawal-executed', 0n],
    ]);
    expect(rows.liquidations.length).toBeGreaterThanOrEqual(1);
    // Keys are unique per (seq, n).
    const keys = [...rows.fills, ...rows.orders, ...rows.cashFlows, ...rows.liquidations].map(
      (r) => `${String(r[0])}:${String(r[1])}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('skips duplicates and is a pure function of the outputs', () => {
    const h = Harness.booted();
    const o = order('alice', 'buy', 100n, { key: 'same' });
    const out = outputs(h, o, o);
    expect(project(out).fills).toHaveLength(1);
    expect(project(out)).toEqual(project(out));
  });
});
