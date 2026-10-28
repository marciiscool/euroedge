import { describe, expect, it } from 'vitest';
import { ticks } from '@euroedge/fixed';
import type { EngineInput } from '../src/core/events.ts';
import { stateDigest } from '../src/log/digest.ts';
import { replay } from '../src/log/replay.ts';
import { data, Harness, order } from './fixtures.ts';

const limit = (
  account: string,
  side: 'buy' | 'sell',
  qty: bigint,
  px: bigint,
  key?: string,
): EngineInput => ({
  ...(order(account, side, qty, key === undefined ? {} : { key }) as Extract<
    EngineInput,
    { type: 'PlaceOrder' }
  >),
  limitPrice: ticks(px),
});
const kinds = (out: ReturnType<Harness['run']>) =>
  out.map((o) => o.type).filter((t) => t !== 'AccountChanged' && t !== 'MarketChanged');

describe('limit orders (M4)', () => {
  it('fills at once as a taker when the house quote is at or better than the limit', () => {
    const h = Harness.booted();
    const out = h.run(limit('alice', 'buy', 100n, 70_100n)); // ask 700.35 ≤ 701.00
    expect(out[0]).toMatchObject({ type: 'OrderFilled', fill: { price: 70_035n, fee: 350_175n } }); // taker 5 bp of 700.35 USDC
    expect(h.state.orders.size).toBe(0);
  });

  it('rests when not marketable and fills later as a maker at the then-current quote', () => {
    const h = Harness.booted();
    expect(kinds(h.run(limit('alice', 'buy', 100n, 69_500n, 'L1')))).toEqual(['OrderAccepted']);
    expect(kinds(h.run(data(69_800n)))).toEqual([]); // ask 698.15 > 695.00: still resting
    const out = h.run(data(69_400n)); // ask 694.35 ≤ 695.00
    const fill = out.find((o) => o.type === 'OrderFilled');
    // Maker fee 1 bp of 694.35 USDC = 69 435 µUSDC (taker would be 5 bp).
    expect(fill).toMatchObject({ fill: { price: 69_435n, fee: 69_435n } });
    expect(h.state.orders.size).toBe(0);
  });

  it('cancels by order id; unknown ids are rejected; placement is idempotent', () => {
    const h = Harness.booted();
    h.run(limit('alice', 'sell', 100n, 71_000n, 'S1'));
    expect(kinds(h.run(limit('alice', 'sell', 100n, 71_000n, 'S1')))).toEqual(['OrderAccepted']);
    expect(h.state.orders.size).toBe(1);
    const c: EngineInput = {
      type: 'CancelOrder',
      requestId: 'c1',
      account: 'alice',
      orderId: 'S1',
    };
    expect(h.run(c)[0]).toMatchObject({ type: 'OrderCancelled', reason: 'user' });
    expect(h.run({ ...c, requestId: 'c2' })[0]).toMatchObject({
      type: 'OrderRejected',
      reason: 'unknown-order',
    });
    expect(h.run({ ...c, requestId: 'c3', account: 'mallory' })[0]).toMatchObject({
      reason: 'unknown-order',
    });
  });

  it('keeps resting orders through a circuit breaker and fills them once it clears', () => {
    const h = Harness.booted();
    h.run(limit('alice', 'buy', 100n, 69_500n, 'OPEN'));
    // Degraded: ask = ceil(694.00 × 1.001) = 694.70 ≤ 695.00 would cross, but no new exposure.
    for (const breaker of ['degraded', 'no-opens', 'reduce-only'] as const) {
      const out = h.run({ ...data(69_400n), breaker } as EngineInput);
      expect(kinds(out), breaker).toEqual([]);
      expect(h.state.orders.size).toBe(1);
    }
    const fill = h.run(data(69_400n)).find((o) => o.type === 'OrderFilled');
    expect(fill).toMatchObject({ fill: { price: 69_435n, fee: 69_435n } }); // maker 1 bp
    expect(h.state.orders.size).toBe(0);
  });

  it('fills a reducing resting order even while a breaker is active', () => {
    const h = Harness.booted();
    h.run(order('alice', 'buy', 100n));
    h.run({ ...limit('alice', 'sell', 100n, 70_500n, 'TP'), reduceOnly: true } as EngineInput);
    // bid = floor(706.00 × 0.9995) = 705.64 ≥ 705.00
    const out = h.run({ ...data(70_600n), breaker: 'reduce-only' } as EngineInput);
    expect(out.find((o) => o.type === 'OrderFilled')).toMatchObject({
      fill: { side: 'sell', price: 70_564n },
    });
    expect(h.state.accounts.get('alice')?.positions.get('ASML-PERP')?.lots).toBe(0n);
  });

  it('cancels a resting order that fails its checks at trigger time', () => {
    const h = Harness.booted();
    // 10 000 USDC equity, 5x: 70 contracts at 695 ≈ 48 650 USDC fits at placement-time limits…
    h.run(limit('alice', 'buy', 7_000n, 69_500n, 'BIG'));
    h.run({ type: 'DevDeposit', account: 'bob', amount: 1n } as EngineInput);
    // …but the price limit vs the index blocks it when the quote crosses: index far away.
    const out = h.run(data(69_400n, 'A', 500n, 69_400n, 80_000n));
    expect(out.find((o) => o.type === 'OrderCancelled')).toMatchObject({ reason: 'price-limit' });
  });

  it('replays resting orders bit for bit', () => {
    const h = Harness.booted();
    h.run(
      limit('alice', 'buy', 100n, 69_000n, 'R1'),
      limit('alice', 'sell', 50n, 72_000n, 'R2'),
      data(68_900n),
    );
    const events = h.log.map((input, i) => ({
      seq: BigInt(i + 1),
      ts: 1_793_000_000_000n + BigInt(i) * 1000n,
      v: 1,
      input,
    }));
    expect(stateDigest(replay(events))).toBe(stateDigest(h.state));
  });
});
