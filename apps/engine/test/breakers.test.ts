import { describe, expect, it } from 'vitest';
import type { EngineInput } from '../src/core/events.ts';
import { decodeEvent, encodeEvent } from '../src/log/codec.ts';
import { data, Harness, order } from './fixtures.ts';

const withBreaker = (breaker: 'no-opens' | 'degraded' | 'reduce-only'): EngineInput => ({
  ...(data(70_000n) as Extract<EngineInput, { type: 'MarketData' }>),
  breaker,
});
const outcome = (out: ReturnType<Harness['run']>) =>
  out.find((o) => o.type === 'OrderFilled' || o.type === 'OrderRejected');

describe('circuit breakers in the engine (brief §6.5)', () => {
  it.each(['no-opens', 'degraded', 'reduce-only'] as const)(
    '%s blocks new exposure but allows reducing',
    (b) => {
      const h = Harness.booted();
      expect(outcome(h.run(order('alice', 'buy', 100n)))?.type).toBe('OrderFilled');
      h.run(withBreaker(b));
      expect(outcome(h.run(order('alice', 'buy', 100n)))).toMatchObject({
        type: 'OrderRejected',
        reason: 'circuit-breaker',
      });
      expect(outcome(h.run(order('alice', 'sell', 50n)))?.type).toBe('OrderFilled');
    },
  );

  it('degraded quotes twice the half-spread', () => {
    const h = Harness.booted();
    const normal = outcome(h.run(order('alice', 'buy', 100n)));
    h.run(withBreaker('degraded'));
    const degraded = outcome(h.run(order('alice', 'sell', 100n)));
    if (normal?.type !== 'OrderFilled' || degraded?.type !== 'OrderFilled')
      throw new Error('expected fills');
    // ask − fv = 1 half-spread; fv − bid = 2 half-spreads.
    expect(70_000n - degraded.fill.price).toBe(2n * (normal.fill.price - 70_000n));
  });

  it('decodes v1 MarketData logs (no breaker field) as none', () => {
    const v1 = encodeEvent({ seq: 1n, ts: 1n, v: 1, input: data(70_000n) })
      .toString('utf8')
      .replace(',"breaker":"none"', '');
    expect(v1).not.toContain('breaker');
    expect(decodeEvent(v1).input).toMatchObject({ type: 'MarketData', breaker: 'none' });
  });
});
