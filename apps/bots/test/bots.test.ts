import { describe, expect, it } from 'vitest';
import { Rng } from '@euroedge/data-adapters';
import { BotFleet, makeBots, type BotTransport } from '../src/fleet.ts';
import {
  arbitrageur,
  meanReversion,
  momentum,
  noise,
  whale,
  type Intent,
  type Random,
} from '../src/strategies.ts';

const always: Random = { uniform: () => 0 }; // acts every tick, minimum size, picks "buy"
const rising = Array.from({ length: 20 }, (_, i) => 700 + i);
const falling = rising.map((m) => 1_400 - m);

describe('bot strategies (M4-24)', () => {
  it('momentum follows a move, mean-reversion fades it', () => {
    expect(momentum().decide({ marks: rising, position: 0n }, always)?.side).toBe('buy');
    expect(momentum().decide({ marks: falling, position: 0n }, always)?.side).toBe('sell');
    expect(meanReversion().decide({ marks: rising, position: 0n }, always)?.side).toBe('sell');
    expect(meanReversion().decide({ marks: falling, position: 0n }, always)?.side).toBe('buy');
  });

  it('stays quiet in a flat market or without history', () => {
    const flat = Array.from({ length: 20 }, () => 700);
    expect(momentum().decide({ marks: flat, position: 0n }, always)).toBeNull();
    expect(meanReversion().decide({ marks: flat, position: 0n }, always)).toBeNull();
    expect(noise().decide({ marks: [], position: 0n }, always)).toBeNull();
  });

  it('never trades past its position limit: it reduces instead', () => {
    const i = momentum().decide({ marks: rising, position: 2_000n }, always);
    expect(i).toEqual({ side: 'sell', lots: 10n, reduceOnly: true });
  });

  it('noise is reproducible from the seed', () => {
    const run = (seed: number) => {
      const rng = new Rng(seed);
      return Array.from({ length: 50 }, () => noise().decide({ marks: [700], position: 0n }, rng));
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});

describe('bot fleet (M4-23)', () => {
  it('creates N accounts round-robin and sends what the strategies decide', async () => {
    const bots = makeBots(200, [noise(), momentum(), meanReversion()]);
    expect(bots).toHaveLength(200);
    expect(bots[0]?.account).toBe('bot-noise-000');
    expect(bots[1]?.account).toBe('bot-momentum-001');
    expect(new Set(bots.map((b) => b.account)).size).toBe(200);

    const sent: { account: string; intent: Intent; requestId: string }[] = [];
    const funded: string[] = [];
    let mark = 700;
    const transport: BotTransport = {
      quote: () => {
        mark += 1;
        return Promise.resolve({ mark, fv: mark, bid: mark - 0.35, ask: mark + 0.35 });
      },
      position: () => Promise.resolve(0n),
      fund: (a) => Promise.resolve(void funded.push(a)),
      place: (account, _m, intent, requestId) =>
        Promise.resolve(void sent.push({ account, intent, requestId })),
    };
    const fleet = new BotFleet(bots, ['ASML-PERP'], transport, new Rng(1));
    await fleet.fundAll();
    expect(funded).toHaveLength(200);
    for (let i = 0; i < 15; i++) await fleet.tick();
    expect(sent.length).toBeGreaterThan(100);
    // Request ids are unique, so the engine's idempotency never swallows a bot order.
    expect(new Set(sent.map((s) => s.requestId)).size).toBe(sent.length);
    expect(sent.some((s) => s.account.startsWith('bot-momentum') && s.intent.side === 'buy')).toBe(
      true,
    );
  });

  it('skips markets without data', async () => {
    const transport: BotTransport = {
      quote: () => Promise.resolve(undefined),
      position: () => Promise.resolve(0n),
      fund: () => Promise.resolve(),
      place: () => Promise.reject(new Error('must not trade')),
    };
    const fleet = new BotFleet(makeBots(3, [noise()]), ['ASML-PERP'], transport, new Rng(1));
    expect(await fleet.tick()).toBe(0);
  });
});

describe('whale and arbitrageur strategies (M4-25/26)', () => {
  it('the whale trades rarely and big, within its limit', () => {
    const w = whale();
    expect(w.decide({ marks: [700], position: 0n }, { uniform: () => 0.5 })).toBeNull();
    const i = w.decide({ marks: [700], position: 0n }, always);
    expect(i?.lots).toBe(50_000n);
    expect(w.decide({ marks: [700], position: 1_000_000n }, always)?.reduceOnly).toBe(true);
  });

  it('the arbitrageur trades only when FV is outside the quote by its edge', () => {
    const a = arbitrageur();
    const at = (fv: number) =>
      a.decide({ marks: [700], position: 0n, fv, bid: 699.65, ask: 700.35 }, always);
    expect(at(700)).toBeNull();
    expect(at(702)?.side).toBe('buy');
    expect(at(698)?.side).toBe('sell');
    expect(a.decide({ marks: [700], position: 0n }, always)).toBeNull(); // no FV known
  });
});
