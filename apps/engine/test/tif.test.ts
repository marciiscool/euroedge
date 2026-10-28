import { describe, expect, it } from 'vitest';
import { ticks } from '@euroedge/fixed';
import type { EngineInput } from '../src/core/events.ts';
import type { EngineOutput } from '../src/core/outputs.ts';
import { data, Harness, order } from './fixtures.ts';

type Place = Extract<EngineInput, { type: 'PlaceOrder' }>;
const limit = (side: 'buy' | 'sell', px: bigint, extra: Partial<Place> = {}): EngineInput => ({
  ...(order('alice', side, 100n) as Place),
  limitPrice: ticks(px),
  ...extra,
});
const outcome = (out: EngineOutput[]) => {
  const o = out.find((x) => ['OrderFilled', 'OrderRejected', 'OrderAccepted'].includes(x.type));
  return o?.type === 'OrderRejected' ? o.reason : o?.type;
};

// FV 700.00, M1 quote: bid 699.65, ask 700.35.
describe('time in force and post-only (M4-05/06)', () => {
  it.each(['ioc', 'fok'] as const)('%s fills a marketable limit at once', (tif) => {
    const h = Harness.booted();
    expect(outcome(h.run(limit('buy', 70_100n, { timeInForce: tif })))).toBe('OrderFilled');
  });

  it.each(['ioc', 'fok'] as const)('%s never rests: a non-marketable limit is rejected', (tif) => {
    const h = Harness.booted();
    expect(outcome(h.run(limit('buy', 69_900n, { timeInForce: tif })))).toBe('not-marketable');
    expect(h.state.orders.size).toBe(0);
  });

  it('post-only rejects a limit that would take, and rests one that would not', () => {
    const h = Harness.booted();
    expect(outcome(h.run(limit('buy', 70_035n, { postOnly: true })))).toBe('would-take');
    expect(outcome(h.run(limit('sell', 69_965n, { postOnly: true })))).toBe('would-take');
    expect(outcome(h.run(limit('buy', 70_034n, { postOnly: true })))).toBe('OrderAccepted');
    // FV −0.2 %: ask ⌈69 860 × 1.0005⌉ = 698.95 ≤ 700.34, so the resting order fills as a maker.
    expect(h.run(data(69_860n)).some((o) => o.type === 'OrderFilled')).toBe(true);
    expect(h.state.orders.size).toBe(0);
  });

  it.each([
    ['IOC without a limit', { timeInForce: 'ioc' }],
    ['post-only without a limit', { postOnly: true }],
    ['post-only and IOC', { limitPrice: ticks(69_000n), postOnly: true, timeInForce: 'ioc' }],
    ['a stop with IOC', { stop: { price: ticks(71_000n), kind: 'stop' }, timeInForce: 'fok' }],
  ] as const)('rejects %s as invalid-order', (_name, extra) => {
    const h = Harness.booted();
    const input = { ...(order('alice', 'buy', 100n) as Place), ...extra } as EngineInput;
    expect(outcome(h.run(input))).toBe('invalid-order');
  });

  it('replays the first outcome for a duplicate key', () => {
    const h = Harness.booted();
    const o = limit('buy', 69_900n, { timeInForce: 'ioc' });
    h.run(o);
    const again = h.run(o).find((x) => x.type === 'OrderRejected');
    expect(again).toMatchObject({ reason: 'not-marketable', duplicate: true });
  });
});
