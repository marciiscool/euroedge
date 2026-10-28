import { describe, expect, it } from 'vitest';
import { ticks } from '@euroedge/fixed';
import type { EngineInput } from '../src/core/events.ts';
import { decodeEvent, encodeEvent, EVENT_VERSIONS } from '../src/log/codec.ts';
import { stateDigest } from '../src/log/digest.ts';
import { replay } from '../src/log/replay.ts';
import { data, Harness, order } from './fixtures.ts';

type Place = Extract<EngineInput, { type: 'PlaceOrder' }>;

const stop = (
  side: 'buy' | 'sell',
  qty: bigint,
  price: bigint,
  kind: 'stop' | 'take-profit',
  o: { key?: string; limit?: bigint; reduceOnly?: boolean; oco?: string } = {},
): EngineInput => ({
  ...(order('alice', side, qty, {
    ...(o.key === undefined ? {} : { key: o.key }),
    reduceOnly: o.reduceOnly ?? false,
  }) as Place),
  stop: { price: ticks(price), kind },
  ...(o.limit === undefined ? {} : { limitPrice: ticks(o.limit) }),
  ...(o.oco === undefined ? {} : { ocoGroup: o.oco }),
});
const kinds = (out: ReturnType<Harness['run']>) =>
  out.map((o) => o.type).filter((t) => t !== 'AccountChanged' && t !== 'MarketChanged');
const lotsOf = (h: Harness) => h.state.accounts.get('alice')?.positions.get('ASML-PERP')?.lots;

/** Alice long 1.00 ASML at 700.35. */
function long(): Harness {
  const h = Harness.booted();
  h.run(order('alice', 'buy', 100n));
  return h;
}

describe('stop and take-profit orders (M4-07)', () => {
  it('a stop-loss fires on the mark and sells at the bid as a taker', () => {
    const h = long();
    expect(kinds(h.run(stop('sell', 100n, 69_000n, 'stop', { reduceOnly: true })))).toEqual([
      'OrderAccepted',
    ]);
    expect(kinds(h.run(data(69_500n)))).toEqual([]); // mark 695.00 > 690.00
    const fill = h.run(data(68_900n)).find((o) => o.type === 'OrderFilled');
    // bid = floor(689.00 × 0.9995) = 688.65; taker 5 bp of 688.65 USDC = 344 325 µUSDC.
    expect(fill).toMatchObject({ fill: { side: 'sell', price: 68_865n, fee: 344_325n } });
    expect(lotsOf(h)).toBe(0n);
    expect(h.state.orders.size).toBe(0);
  });

  it('rejects a stop that would fire at once, and a reduce-only stop with nothing to reduce', () => {
    const h = Harness.booted();
    const out = h.run(stop('sell', 100n, 70_100n, 'stop'));
    expect(out[0]).toMatchObject({ type: 'OrderRejected', reason: 'would-trigger' });
    const ro = h.run(stop('sell', 100n, 69_000n, 'stop', { reduceOnly: true }));
    expect(ro[0]).toMatchObject({ type: 'OrderRejected', reason: 'reduce-only' });
    expect(h.state.orders.size).toBe(0);
  });

  it('TP/SL as OCO: the take-profit fills and cancels the stop-loss', () => {
    const h = long();
    h.run(
      stop('sell', 100n, 71_000n, 'take-profit', { reduceOnly: true, oco: 'tpsl' }),
      stop('sell', 100n, 69_000n, 'stop', { reduceOnly: true, oco: 'tpsl' }),
    );
    expect(h.state.orders.size).toBe(2);
    const out = h.run(data(71_200n));
    expect(kinds(out)).toEqual(['OrderFilled', 'OrderCancelled']);
    // bid = floor(712.00 × 0.9995) = 711.64
    expect(out.find((o) => o.type === 'OrderFilled')).toMatchObject({ fill: { price: 71_164n } });
    expect(out.find((o) => o.type === 'OrderCancelled')).toMatchObject({ reason: 'oco' });
    expect(h.state.orders.size).toBe(0);
  });

  it('a buy stop-limit fires on a rise and fills if the ask is within its limit', () => {
    const h = Harness.booted();
    h.run(stop('buy', 100n, 70_500n, 'stop', { limit: 70_600n }));
    const fill = h.run(data(70_550n)).find((o) => o.type === 'OrderFilled');
    // ask = ceil(705.50 × 1.0005) = 705.86 ≤ 706.00, taker
    expect(fill).toMatchObject({ fill: { side: 'buy', price: 70_586n } });
  });

  it('a fired stop-limit that does not cross rests on as a maker limit', () => {
    const h = Harness.booted();
    h.run(stop('buy', 100n, 70_500n, 'stop', { key: 'SL1', limit: 70_600n }));
    expect(kinds(h.run(data(70_590n)))).toEqual([]); // ask 706.26 > 706.00
    expect(h.state.orders.get('alice:SL1')).toMatchObject({ stop: null, limitPrice: 70_600n });
    const fill = h.run(data(70_500n)).find((o) => o.type === 'OrderFilled');
    // ask = ceil(705.00 × 1.0005) = 705.36; maker 1 bp of 705.36 USDC = 70 536 µUSDC.
    expect(fill).toMatchObject({ fill: { price: 70_536n, fee: 70_536n } });
  });

  it('an opening stop waits out a circuit breaker and fires once it clears', () => {
    const h = Harness.booted();
    h.run(stop('buy', 100n, 70_500n, 'stop', { key: 'B' }));
    expect(kinds(h.run({ ...data(70_550n), breaker: 'no-opens' } as EngineInput))).toEqual([]);
    expect(h.state.orders.get('alice:B')?.stop).not.toBeNull();
    expect(kinds(h.run(data(70_550n)))).toEqual(['OrderFilled']);
  });

  it('a reduce-only stop is cancelled at trigger time once the position is gone', () => {
    const h = long();
    h.run(stop('sell', 100n, 69_000n, 'stop', { reduceOnly: true }));
    h.run({
      type: 'ClosePosition',
      requestId: 'c',
      idempotencyKey: 'c',
      account: 'alice',
      market: 'ASML-PERP',
    });
    const out = h.run(data(68_900n));
    expect(out.find((o) => o.type === 'OrderCancelled')).toMatchObject({ reason: 'reduce-only' });
  });

  it('replays conditional orders bit for bit', () => {
    const h = long();
    h.run(
      stop('sell', 100n, 71_000n, 'take-profit', { reduceOnly: true, oco: 'g' }),
      stop('sell', 100n, 69_000n, 'stop', { reduceOnly: true, oco: 'g' }),
      stop('buy', 50n, 70_800n, 'stop', { limit: 70_900n }),
      data(70_850n),
      data(68_000n),
    );
    const decoded = h.log.map((input, i) =>
      decodeEvent(
        encodeEvent({
          seq: BigInt(i + 1),
          ts: 1_793_000_000_000n + BigInt(i) * 1000n,
          v: EVENT_VERSIONS[input.type],
          input,
        }),
      ),
    );
    expect(stateDigest(replay(decoded))).toBe(stateDigest(h.state));
  });
});
